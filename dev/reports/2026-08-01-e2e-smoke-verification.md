# End-to-end smoke verification — the merged Phase 1 remediation, running as a real Worker

**Date:** 2026-08-01
**Branch:** `claude/e2e-smoke`, cut from `dev` at `a60483f`
**Server:** `wrangler dev` on the OpenNext build, **port 8795**, `127.0.0.1`, real D1 + real secret
bindings. Not `next dev`.
**Baseline before any change:** `npm test` → 61 files / 836 passed / 2 skipped, as expected.

This is the first pass that exercises today's 22 behaviour changes as a **running application**
rather than through unit tests and jsdom. Everything below is a measured request/response or a
quoted log line.

**Overall verdict: the merged work holds up.** Seven of the eight items pass outright. The eighth
(item 6) passed on the surface it was asked about and, while probing around it, turned up **one
real defect** — a third, unguarded read of `recommendations.ai_response` that made
`POST /api/movie-sessions/[id]/match` return `500` forever on a session holding a malformed round.
That is the exact failure class B13 set out to close, surviving at a call site B13 did not cover.
It is fixed on this branch, TDD, in four lines.

One item's brief and the merged plan **disagree with each other** (item 2's UI framing). The code
follows the plan. Flagged rather than changed.

---

## Part 1 — Runbook, as extended by this pass

`dev/reports/2026-08-01-authenticated-a11y-verification.md` Part 1 is accurate and was followed as
written. Everything below is an addition to it, not a correction.

### Pick a port and say which

Port **8795** here. The a11y pass used 8791 and had 8787 stolen mid-run by a sibling worktree.
Sibling agents are still active in this repo (`.claude/worktrees/enrichment-partial-failure`), so
this remains live advice.

### `.dev.vars` used

```
JWT_SECRET=local-e2e-smoke-secret-do-not-use-in-production
GOOGLE_CLIENT_ID=local-dummy-client-id
GOOGLE_CLIENT_SECRET=local-dummy-client-secret
ANTHROPIC_API_KEY=sk-ant-local-dummy-not-a-real-key
TMDB_API_TOKEN=local-dummy-not-called
```

Confirmed gitignored: `git check-ignore -v .dev.vars` → `.gitignore:94`. `MONTHLY_MATCH_LIMIT` was
appended and removed per scenario, and the Worker restarted each time — **`.dev.vars` is read at
boot, so a limit change without a restart tests the old value.** The binding line in wrangler's
startup banner (`env.MONTHLY_MATCH_LIMIT … Environment Variable … local`) is the cheap confirmation
that the restart took.

### `npm run migrate:local` needs a clean slate, and that is by design

`package.json` carries a `//migrate:local` note about this. `rm -rf .wrangler/state/v3/d1` first.

### The dummy Anthropic key is a measuring instrument, not just a placeholder

Worth stating plainly because it does a lot of work in this report: with a bogus
`ANTHROPIC_API_KEY`, **every** request that actually reaches `api.anthropic.com` produces exactly
one log line —

```
{"event":"provider_auth_failed","status":401}
```

So the **absence** of that line is positive evidence that no outbound provider call was made, and
its presence is positive evidence that one was. Combined with wall-clock time (~200–450 ms when the
call goes out, ~5–70 ms when it is refused locally), this gives item 1 a real proof rather than an
argument from reading the code.

### Minting a session

Same script as the a11y runbook, parameterised so several independent "devices" can be minted for
the same user (needed for item 3). Saved as `mint-session.mts` at the repo root, run with
`npx tsx`, deleted afterwards:

```ts
import { readFileSync } from "node:fs";
import { createJWT, sha256, REFRESH_EXPIRY_DAYS } from "./src/lib/auth";
import { parseDevVars } from "./scripts/seed-lib";

const USER_ID = process.argv[2] ?? "user-e2e";
const EMAIL = process.argv[3] ?? "sam.e2e@example.test";

const secret = parseDevVars(readFileSync(".dev.vars", "utf-8")).JWT_SECRET!;
const jwt = await createJWT({ userId: USER_ID, email: EMAIL }, secret);
const refresh = crypto.randomUUID();
const hash = await sha256(refresh);
const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 86400_000).toISOString();
console.log(JSON.stringify({ userId: USER_ID, jwt, refresh, hash, sql: `INSERT INTO sessions …` }));
```

Running it twice for the same user gives two independent `sessions` rows — that is what makes
"another device's ACTIVE session is untouched" testable.

### Proof of a signed-in app, taken before anything was measured

```
$ curl -s -H "Cookie: mn-session=$JWT" http://127.0.0.1:8795/api/auth/me
{"userId":"user-e2e","email":"sam.e2e@example.test","name":"Sam Verifier","avatarUrl":null}
HTTP 200

$ curl -s http://127.0.0.1:8795/api/auth/me          # negative control
{"error":"Unauthorized"}
HTTP 401
```

### Fixture shape traps, in addition to the two the a11y runbook already lists

- **A single bulk `INSERT` of 2000 rows hits `SQLITE_TOOBIG`** through
  `wrangler d1 execute --file`. Twenty statements of 100 rows each apply fine. Needed for the
  monthly-cap boundary (item 1).
- **`MAX_ROUNDS_PER_SESSION` is checked before the monthly cap**, so parking bulk
  `recommendations` rows on the session you are about to POST to gives you `round_limit`, not
  `monthly_cap`, and the test silently measures the wrong gate. Park them on a throwaway session.
- **Driving React from `javascript_tool`:** state updates are batched, so
  `chip.click(); save.click()` in one expression saves the *pre-click* state. Sleep between them.
  Chips are `role="checkbox"` / `aria-checked`, not `aria-pressed`; the save confirmation is an
  `aria-live="polite"` region, so a `[role="status"], [role="alert"]` query misses it. All three
  cost time here and none of them were app bugs.

---

## Part 2 — The eight items

### 1. B7 — the cost kill-switch actually blocks — **PASS**

`MONTHLY_MATCH_LIMIT=0`, Worker restarted, binding confirmed present in the banner:

```
$ curl -X POST .../api/movie-sessions/sess-good/match -d '{}'
{"error":"We're getting a lot of requests right now, try again later","kind":"monthly_cap"}
HTTP 429  time=0.071862s

$ curl -X POST .../api/movie-sessions/<a solo session>/match -d '{}'
{"error":"We're getting a lot of requests right now, try again later","kind":"monthly_cap"}
HTTP 429  time=0.005923s
```

**No outbound Anthropic request left the process.** `grep -c provider_auth_failed` over the whole
server log for that run: **0**, against 2 POSTs. For contrast, the same POST with the limit unset
produced the line and took 286 ms. A 5.9 ms response cannot contain a TLS handshake to
`api.anthropic.com`.

The boundary cases in the code comment were also checked live, at **2000 recommendation rows dated
this month** (so `DEFAULT_MONTHLY_MATCH_LIMIT = 2000` is exactly reached), on a session at round 2
so the round limit could not mask the result:

| `MONTHLY_MATCH_LIMIT` | Result | `provider_auth_failed` lines |
|---|---|---|
| `0` | `429 monthly_cap`, 62 ms | 0 |
| `-1` | `429 monthly_cap`, 59 ms | 0 |
| `abc` | `429 monthly_cap`, 61 ms | 0 |
| unset | `429 monthly_cap`, 60 ms | 0 |

`-1` blocking at 2000 rows is the load-bearing observation: it proves a negative value falls back to
the default rather than reading as unlimited (`count >= -1` would have let the call through). This
is the one place a unit test cannot distinguish the two, because both "unlimited" and "2000" allow
the request at low row counts.

### 2. B7b — provider-auth errors are typed — **PASS at the API; the brief and the plan disagree about the UI**

Dummy key, `MONTHLY_MATCH_LIMIT` unset:

```
$ curl -X POST .../api/movie-sessions/sess-good/match -d '{}'
{"error":"Our movie brain is taking a nap — try again in a moment","kind":"provider_auth"}
HTTP 503  time=0.286664s
```

Server log:

```
✘ [ERROR] {"event":"provider_auth_failed","status":401}
[wrangler:info] POST /api/movie-sessions/sess-good/match 503 Service Unavailable (286ms)
```

So: a real 401 from Anthropic → `MatchingError("provider_auth")` → `503` with `kind:"provider_auth"`
and the distinct operator log line. **Not a generic 500.** Exactly the contract.

**The UI, rendered in the browser.** Clicking "Find our match →" on a session with a dummy key
produces:

> **Our movie brain is having a lie-down**
> Our movie brain is taking a nap — try again in a moment

That is byte-identical to the `overloaded` and `timeout` framing, with a retry offered.

The brief for this pass asked for provider_auth to "render its own framing … not the
`overloaded`/`timeout` framing, which promise a retry that can never work for a revoked key." **The
merged plan asks for the opposite**, explicitly, in two places:

- `dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md:1616` specifies
  `["provider_auth", { heading: "Our movie brain is having a lie-down", retry: true }]` verbatim.
- Line 1635 asks for a test that `provider_auth` *renders the lie-down framing*.
- The server-side copy carries its own justification in
  `src/app/api/movie-sessions/[id]/match/route.ts`: *"Deliberately the same copy as
  timeout/overloaded: the user cannot act on our credentials and must not be told about them."*
- And the client map in `src/app/results/[sessionId]/page.tsx:54-56`: *"Indistinguishable from a
  transient outage on this side, and an operator rotating a key back is the far commoner case than
  one that stays revoked."*

**The code matches the plan.** I have not changed it: the two rationales are both defensible and
choosing between them is a product call, not a verification finding. Recording it so it is not
double-reported as a defect later.

### 3. G1 — logout kills the grace-window predecessor — **PASS**

Driven through the real rotation path: a request carrying **only** `mn-refresh` (the state a browser
reaches once the 15-minute JWT lapses).

**Rotation happens and issues cookies.**

```
$ curl -D- -H "Cookie: mn-refresh=$P" .../api/auth/me
HTTP 200  {"userId":"user-e2e",…}
Set-Cookie: mn-session=<…>; Max-Age=900; HttpOnly; SameSite=Lax; Path=/
Set-Cookie: mn-refresh=<…>; Max-Age=7776000; HttpOnly; SameSite=Lax; Path=/
```

D1 after: the presented row now has `rotated_at = 2026-08-01T23:07:14.017Z`, a new unspent row
exists. That is the single-winner arbiter doing its job.

**The predecessor authenticates inside its grace window, and issues nothing** — the `issued === 0`
branch:

```
$ curl -D- -H "Cookie: mn-refresh=$P" .../api/auth/me     # P is now spent
HTTP 200  {"userId":"user-e2e",…}
Set-Cookie count: 0
```

**Logout with the successor kills it.** Full sequence, timestamped, 259 ms end to end — an order of
magnitude inside the 30 s `ROTATION_GRACE_MS`, so the predecessor was unambiguously still graced
when it was revoked:

```
[2026-08-01T23:08:06.923Z] rotate
[2026-08-01T23:08:06.993Z] predecessor pre-logout:  200
[2026-08-01T23:08:07.049Z] logout(successor):       200
                            Set-Cookie: mn-session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/
                            Set-Cookie: mn-refresh=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/
[2026-08-01T23:08:07.121Z] predecessor post-logout: 401
[2026-08-01T23:08:07.182Z] other active device:     200
```

- Predecessor **200 → 401** across the logout. This is the finding G1 was about.
- Successor also 401 (its own row deleted).
- **Another device's ACTIVE, never-rotated session is untouched: 200.** This is the property the
  scoped `rotated_at IS NOT NULL` delete exists to preserve, and it holds.

**Plain round trip, through the actual UI.** Signed in, clicked the nav avatar → "Sign out":
redirected to `/`, `document.cookie` empty, `/api/auth/me` → `401 {"error":"Unauthorized"}`, nav
re-rendered to "Sign in" / "Sign in with Google". Clean.

### 4. B2 — leaving a group revokes match authority — **PASS**, including the `__solo__` guard

Control first, so the 403 below cannot be an artefact of something else failing:

| Step | Result |
|---|---|
| `POST .../sess-leave/match` **while a member** | `503 provider_auth` — got past the gate, reached the provider |
| `POST /api/groups/grp-leave/leave` | `200 {"ok":true}` |
| `POST .../sess-leave/match` **after leaving** | **`403`** `{"error":"You've left this group — you can still read this evening, but not run it again","kind":"left_group"}` |
| `GET /api/movie-sessions/sess-leave` after leaving | **`200`**, full session + round 1 + hydrated titles |
| `GET /api/groups` after leaving | `200`, the left group is gone from the list |

Read survives, write authority does not — which is the whole point. In the browser, "Show me
different options" on that session renders:

> **You've left this group**
> You've left this group — you can still read this evening, but not run it again

**The `__solo__` guard:**

| Step | Result |
|---|---|
| `POST /api/groups/solo-user-e2e/leave` | `200 {"ok":true}` |
| `group_members` rows for that group/user afterwards | **1** — the no-op held |
| `POST .../<a solo session>/match` afterwards | `503 provider_auth` — **not** `left_group` |

### 5. B15 — solo group bootstrap is idempotent — **PASS**, including concurrently

Five **simultaneous** `POST /api/movie-sessions` with `groupId: null` against a user with no solo
group at all (the genuine cold-start double-tap), then three sequential ones. All eight returned
`200` with distinct session ids. D1 afterwards:

```
solo_groups: 1   solo_memberships: 1   ids: "solo-user-e2e"   solo_sessions: 8
```

Exactly one group, exactly one membership row, all eight sessions inside it. The derived-id design
(`solo-${userId}` + `INSERT OR IGNORE` + re-`SELECT` by `invite_code`) does what it claims under
real concurrency, not just in a sequential test.

### 6. The results page renders from a seeded recommendation — **PASS**, and see the defect below

**Valid round** (`/results/sess-good`, a two-member `MatchingResponse`):

- **Taste map tab** — both members with summaries, `primaryVibes` and `genreAffinities` chips, the
  "Where you meet" panel with `sharedVibes` and a `WHERE IT PULLS` tension list. Correct.
- **The picks tab** — all five recommendations, ranked 1–5, with match scores (94/88/85/79/71),
  year · genres, explanation, and streaming resolved from `StreamingInfo` ("On Netflix",
  "Rent on Amazon Video", "On Max"). Correct.
- **In words tab** — the `conversational` string. Correct.
- Zero console errors across all three.

**Deliberately malformed `ai_response`, two shapes:**

| Seeded blob | `GET /api/movie-sessions/[id]` | Log | Page |
|---|---|---|---|
| Valid JSON, wrong shape (`overlap.sharedVibes` a string; a rec missing `explanation`) | `200`, `"response":null`, `"titles":{}` | `{"event":"corrupt_ai_response","session_id":"sess-bad","round":1}` | "Nothing picked yet" + working **Find our match →** |
| Not JSON at all (`this is not json at all {{{`) | `200`, `"response":null` | `{"event":"corrupt_ai_response","session_id":"sess-notjson","round":1}` | same |

So B13's shared predicate degrades rather than crashing, and it logs. The page is **not** bricked —
the recovery button is present and, on the malformed session, pressing it ran a fresh round that
failed only at the (dummy-key) provider, rendering the provider_auth framing inline while leaving
the button in place.

**But** — probing one shape further found the gap below.

### 7. Migrations apply cleanly from scratch — **PASS**

```
$ rm -rf .wrangler/state/v3/d1 && npm run migrate:local
0001 → 🚣 19 commands executed successfully.
0002 → 🚣  1 command  executed successfully.
0003 → 🚣  2 commands executed successfully.
0004 → 🚣  4 commands executed successfully.
EXIT=0
```

In order, no error. Resulting schema:

- **13 tables:** `group_members, groups, movie_sessions, profiles, rate_limit_log, recommendations,
  session_members, sessions, tension_axes, titles, users, watch_history, watch_ratings`.
- **New columns present:** `sessions.rotated_at` ✓, `titles.last_refresh_attempt_at` ✓ (verified via
  `pragma_table_info`).
- **0004 index changes, all four, verified by listing `sqlite_master`:**
  `idx_recommendations_created_at` **created**; `idx_recommendations_session_round` **created**;
  `idx_recommendations_session` **absent**; `idx_movie_sessions_group` **absent**. Six indexes total.

### 8. The profile save path — **PASS** *(pre-dates the in-flight enrichment change)*

Everything in this section describes `a60483f`. `dev` has since moved to `d99cf7c`, which merged the
concurrent enrichment-failure work (`19a9c31`, `5fa857a`). **Read the last row of this table as a
description of the old behaviour, not as a complaint about it.**

| Case | Result |
|---|---|
| `GET /api/user/profile` | `200`, the seeded profile |
| `PUT` with only ids already in `titles` | `200`, echoes the saved profile; no TMDB call; **3 ms** |
| `PUT` with 51 ids in one list | `400 "comfortTitles can hold at most 50 titles"` (the list validator fires first) |
| `PUT` with 50 unknown in `comfortTitles` + 1 unknown in `watchlist` = 51 unknown | `400 "A save can add at most 50 titles that aren't in our catalog yet — save some, then add the rest"` + `unknownIds` — the ceiling raised in `6f54eac`, at its exact boundary |
| `PUT` with exactly 50 unknown | passes the cap, then `400 "Some titles could not be fetched from TMDB"` + all 50 in `failedIds` |
| `PUT` with one unknown id (550) | `400 {"error":"Some titles could not be fetched from TMDB","failedIds":[550]}`, and **the profile was not saved** — a re-`GET` returned the pre-`PUT` value |

**Through the UI:** `/profile` rendered the saved state correctly (3 comfort films, 2 watchlist, "2
of 30 chosen" vibes, 1 dealbreaker, the streaming row). Toggling a vibe chip and pressing "Save
changes" produced `PUT /api/user/profile 200 OK (7ms)` and a re-`GET` showed
`vibes: ["Cozy","Cerebral","Quirky"]`. Round trip works.

**One measurement worth keeping:** the 50-unknown-id save took **4238 ms** even though every one of
the 50 TMDB calls failed instantly on a bad token. The loop is sequential by construction (the code
comment says so). With TMDB actually responding, the real figure is materially worse, and this is
the request "Continue" blocks on in the ritual. Not a defect against any claim — the cap comment
already names the cost — but the number is now measured rather than estimated.

---

## Part 3 — Defect found and fixed

### D1 — a malformed stored round makes `POST …/match` return 500 forever

**Severity:** moderate. **Status:** fixed on this branch, TDD.

**What happens.** `getRecommendedTmdbIds` (`src/lib/movie-sessions.ts`) is a **third** read of
`recommendations.ai_response`, and the only one B13 did not put behind `isMatchingResponse`. It ran
`for (const rec of parsed?.recommendations ?? [])`. A stored blob whose `recommendations` is present
but not iterable throws straight out of the match route's `try`, past the `MatchingError` branch,
into the generic handler.

**Reproduction** (exactly as run, on the live Worker):

```sql
INSERT INTO recommendations (id, session_id, round_number, ai_response, …)
VALUES ('rec-recnum','sess-recnum',1,'{"tasteMap":{},"recommendations":5,"conversational":"x"}', …);
```

```
$ curl .../api/movie-sessions/sess-recnum                       # read path — guarded
{"session":{…},"round":1,"response":null,"titles":{}}
HTTP 200
  log: {"event":"corrupt_ai_response","session_id":"sess-recnum","round":1}

$ curl -X POST .../api/movie-sessions/sess-recnum/match -d '{}' # match path — unguarded
{"error":"Match failed"}
HTTP 500
  log: POST /api/movie-sessions/[id]/match:
       TypeError: number 5 is not iterable (cannot read property Symbol(Symbol.iterator))
```

**Why it matters more than the row's obscurity suggests.** The two paths disagree, and the
disagreement is exactly the shape of the bug B13 was written to kill. The results page degrades to
"Nothing picked yet" and offers **Find our match →** as the way out — and that button is wired to
the path that 500s. The user is shown a working-looking recovery affordance that can never succeed:
*one bad response bricks the page forever*, which is the phrasing in the brief.

**Reachability, stated honestly.** `parseMatchingResponse` validates before persisting, so today's
writer cannot produce this row. It arrives only from data persisted before the validator existed, a
direct DB write, or a future writer that forgets. The plan's own justification for sharing the
predicate — *"a blob that was persisted before a validator existed cannot reach the renderer
either"* (`src/lib/matching.ts:395-399`) — is precisely the argument for covering this call site
too. It was missed.

**The fix** (`src/lib/movie-sessions.ts`, 4 lines + comment):

```ts
if (!Array.isArray(parsed?.recommendations)) continue;
for (const rec of parsed.recommendations) {
```

`Array.isArray` rather than `isMatchingResponse` deliberately. This function builds a *provenance*
set, and the per-entry `Number.isInteger(rec?.tmdbId)` guard below it already shows the intent is
salvage, not all-or-nothing. Applying the strict predicate here would discard an entire round's ids
over an unrelated field — silently dropping the user's keep/remove intent — which is a worse
behaviour than the one being fixed.

**It survived a refactor while this branch was open.** `dev` moved to `a40ddae` mid-pass, and PR #31
(`claude/match-read-batching`) folded this read into `getMatchRoundContext`'s `db.batch`, renaming
the function to `toRecommendedTmdbIds`. The unguarded loop was carried through **verbatim** —
`git show origin/dev:src/lib/movie-sessions.ts` still has
`for (const rec of parsed?.recommendations ?? [])`. So the defect is live on current `dev`, not only
on the `a60483f` this branch was cut from. After merging `dev` in, the guard was re-verified by
temporarily reverting it against the refactored code: the test fails with the identical
`TypeError: number 5 is not iterable`, and passes with it restored.

**TDD, in order.** Test added to `src/lib/movie-sessions.test.ts` first, run first, and it failed
with the same `TypeError` at the same line the Worker had thrown at:

```
FAIL … getRecommendedTmdbIds > skips a round whose recommendations field is not an array
TypeError: number 5 is not iterable (cannot read property Symbol(Symbol.iterator))
 ❯ getRecommendedTmdbIds src/lib/movie-sessions.ts:179:23
```

Then the fix; 43/43 pass. Then rebuilt and re-verified **on the live Worker**: the same POST that
returned `500 {"error":"Match failed"}` now returns `503 provider_auth` — i.e. it gets all the way
to the provider call and fails only on the dummy key — while `sess-good` still behaves identically.

---

## Part 4 — Observations, not defects

Recorded so they are not rediscovered as findings.

**O-1 — `left_group` sets `retry: false`, but the refine panel keeps offering a retry.**
`framing.retry` gates only the "Try again" button *inside* the error panel. `RefinePanel`'s "Show me
different options" is governed by `exhausted`, which is set only for `round_limit`. Measured after a
`left_group` failure: the error panel correctly shows no "Try again", and the panel below it still
offers "Show me different options", which will 403 every time. The plan (line 1455-1457) specifies
only the `ERROR_FRAMING` entry, so the code implements what was asked — this is an unclosed edge in
the surrounding UI, not a contract violation.

**O-2 — round limit precedes monthly cap.** `MAX_ROUNDS_PER_SESSION` is checked before
`MONTHLY_MATCH_LIMIT`, so a session at round 11 reports `round_limit` even when the account is also
over its monthly cap. Matches the code order; noted because it made a first attempt at the item-1
boundary test measure the wrong gate.

**O-3 — profile save enrichment is sequential**, 4238 ms for 50 unknown ids with every TMDB call
failing instantly. See item 8.

---

## Part 5 — What was NOT exercised, and why

Being explicit, because the blind spots are large and structural.

### No Anthropic credentials — the single biggest gap

Every match request in this pass ended at a 401. **No successful matching round was ever produced
end to end.** Unverified as a consequence:

- `parseMatchingResponse` against real model output — clamping, unknown-id dropping, the
  structured-outputs schema round trip.
- The `malformed`, `thin_results`, `timeout`, `overloaded` and `rate_limited` kinds. Only
  `provider_auth`, `monthly_cap`, `round_limit` and `left_group` were reached with a live server.
- Round persistence of a real round, the `round_persist_failed` path, and titles hydration of real
  recommendations (`getTitlesMap` was only exercised against seeded rows).
- The refinement loop: kept/removed id carrying across rounds, `getAccumulatedRemovedIds`,
  steering feedback reaching the prompt, and `round_limit` firing at round 11 for real.
- `PhasedLoading` — the loading narrative never rendered, because nothing ever took long enough.
- Prompt assembly at real size, including the sanitisation added in `4e3512d`.

### No TMDB credentials

- The enrichment **success** path in `PUT /api/user/profile` never ran. Only the failure branch was
  observed. `detailToTitle` / `detailToEnrichment` are unexercised live, and so is the
  `last_refresh_attempt_at` stamping added in `8a48168` on that writer.
- `npm run seed:local` is unusable; every title row here was hand-seeded.
- **The cron path is entirely unexercised.** `worker.ts`'s `scheduled()` and
  `src/lib/cron-handler.ts` — the weekly title refresh that `0003`'s
  `last_refresh_attempt_at` column exists to serve — were never triggered. Wrangler does not fire
  cron locally without `/cdn-cgi/handler/scheduled`, and the handler would need TMDB anyway.
- Poster images 404 (`image.tmdb.org`), as in the a11y pass.

### Auth surfaces reached only by minting

`/api/auth/google` and its callback were never walked. Sessions were manufactured, so **arctic's
OAuth state/verifier cookies, the Google ID-token decode, and first-login user creation are
unverified.** Everything in item 3 is about what happens *after* a session exists.

### Other

- **Groups:** create/leave/list were exercised; **join-by-code, the invite-code format check, and
  the join rate limiter (`checkJoinRateLimit`) were not.**
- **Account deletion** (`/api/user/account`, `src/lib/account.ts`) was not touched.
- **Everything is local.** No deployed-environment or remote-D1 check. Notably, `isSecure` is false
  throughout, so the `Secure` cookie attribute was never emitted or tested.
- **Concurrency** was tested for solo-group bootstrap (5-way, real) and for the rotation grace
  branch (reached by sequential replay of a spent token, which is the same `issued === 0` code
  path). Two genuinely simultaneous rotations of the same refresh token were not forced.
- **Rendering was checked at desktop width only.** Narrow-viewport behaviour is the a11y pass's
  subject, not this one.

---

## Verdict

The merged Phase 1 remediation composes correctly in a real Worker with real bindings. The kill
switch closes, and closes *before* the network. Provider-auth failures are typed and logged as an
operator condition. Logout reaches into the rotation grace window without touching other devices.
Leaving a group takes write authority and leaves reads alone, and the solo-group carve-out holds.
Solo bootstrap is idempotent under real concurrency. Migrations apply from nothing to the right
13-table schema. The results page renders, and it survives a corrupt round.

One real defect, found by pushing on the corrupt-round case rather than by anything the plans
predicted, and fixed here. One documented disagreement between this pass's brief and the merged plan
about `provider_auth`'s UI framing, left for Sam. Everything else is clean, and the blind spots
above are all credential-shaped rather than code-shaped.

**Gates:** at the point the verification was done, on `a60483f`: `npx tsc --noEmit` clean,
`npm run lint` clean, `npm test` 61 files / **837 passed** / 2 skipped (baseline 836, +1 for the new
regression test). After merging `dev` (which had advanced to `a40ddae`) into this branch and
re-pointing the new test at `getMatchRoundContext`: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm test` **63 files / 862 passed / 2 skipped**.

**One caveat on scope after that merge.** Everything measured in Parts 1–2 was measured against
`a60483f`. The three PRs `dev` gained mid-pass — enrichment partial-failure (#29), poster srcset
(#30) and match-read batching (#31) — were **not** re-verified against a running Worker. #31 in
particular changes how the match route reads D1 (five sequential reads become one `db.batch`), which
is exactly the kind of change this pass exists to check and is now unexercised end to end.

---

# Follow-up pass — 2026-08-01, branch `claude/refine-after-leave`, cut from `dev` at `5d76a38`

Everything above was measured against `a60483f` and is left exactly as it was written; that
context matters. This section is a **separate, later pass** with two jobs: close O-1, and
re-verify the three PRs the caveat at the end of Part 5 names as unexercised (#29, #30, #31).

**Server:** `wrangler dev` on the OpenNext build, **port 8799**, `127.0.0.1`, real D1 + real
secret bindings. **Baseline before any change:** `npm test` → 63 files / **862** passed / 2
skipped. (A brief carried into this pass said 861; 862 is correct — PR #32 added the
`getMatchRoundContext` regression test.)

## Part 6 — O-1 closed: every refinement affordance now shuts, not just the retry

O-1 above recorded that `framing.retry` gates only the "Try again" button *inside* the error
panel, while `RefinePanel`'s "Show me different options" is governed by `exhausted`, which is
set only for `round_limit` — so it stays live after a `left_group` failure and 403s every time.

**Reading the page found a second instance of the same class.** The `response === null ||
round === 0` branch ("Nothing picked yet") renders **Find our match →**, which posts to the
same route and was gated by nothing at all. An ex-member can still *read* a session that never
matched — the read path deliberately survives leaving — so that button is reachable, and it was
a guaranteed 403 in exactly the same way. That is the affordance the report's own Part 3
described as "a working-looking recovery affordance that can never succeed", arrived at from
the other direction.

**The fix, at the page rather than at either button.** Membership is only observable from a
refusal (the GET still serves an ex-member 200), so `results/[sessionId]/page.tsx` derives
`leftGroup = refineError?.kind === "left_group"` once, alongside the existing `exhausted`, and
that one value gates all three affordances: the error panel's retry (already correct, via
`framing.retry`), the no-round CTA, and `RefinePanel`. Nothing on the page posts to the match
route without passing through it — `runMatchRound` has exactly one caller, confirmed by grep.

`RefinePanel` gained a `leftGroup` prop rather than reusing `exhausted`, because they are
different facts and the copy must not lie: leaving takes the *authority*, not the budget, and
telling an ex-member their rounds ran out would be false. `leftGroup` wins the ordering when
both hold. The panel's note reads:

> You've left this group. Tonight's picks stay readable, but the next round isn't yours to run.
> Start over for a session of your own.

**Disabled, not hidden.** A vanished button is not an explanation. Both controls take the
canonical treatment from `src/components/control-classes.ts` for free — `primaryButtonClasses`
already composes `disabledFillClasses` — so nothing hand-spells a `disabled:` variant and the
`control-classes.test.ts` guard is untouched. Measured in a real browser (not jsdom) on the
running Worker, the disabled CTA computes to `background-color: rgb(45, 53, 72)` = `slate`,
`color: rgb(139, 149, 168)` = `ash`, `opacity: 1` — DESIGN.md's rule, painted. **"Start over"
stays live**, because starting a session of your own is the way out.

**Server-side untouched:** the gate, the `left_group` kind and its error-panel framing are as
merged. This is UI only.

**TDD.** Three tests first, run first, all three failing on the same claim — the control is
still live:

```
FAIL src/components/refine-panel.test.tsx > RefinePanel > closes refinement once the viewer
     has left the group and explains why
AssertionError: expected false to be true // Object.is equality
 ❯ expect(regenerate().hasAttribute("disabled")).toBe(true);   refine-panel.test.tsx:130
```

The two page-level tests failed identically at `regenerate` and at the no-round CTA. In the
third, the assertion *above* the failing one already passed (`refine-error-heading` reads
"You've left this group"), which is what pins the failure to the live button rather than to a
broken error path.

**Verified end to end on the Worker, both paths**, as an ex-member of two groups:

| Path | Result |
|---|---|
| `/results/sess-leave` (no round, group left) — click **Find our match →** | `403 left_group`, alert renders, CTA `disabled`, classes `disabled:bg-slate disabled:text-ash disabled:hover:bg-slate` |
| `/results/sess-good` (round 1 stored, group left) — click **Show me different options** | `403 left_group`, error panel with **no** "Try again", panel note rendered, regenerate `disabled` and painted slate/ash, **Start over** enabled |
| Reading either session afterwards | unchanged — picks, taste map and write-up all still render |

## Part 7 — Re-verification of #29, #30 and #31 against a running Worker

Same runbook as Part 1, with a fresh `.dev.vars` (`git check-ignore -v .dev.vars` →
`.gitignore:94`), `rm -rf .wrangler/state/v3/d1 && npm run migrate:local`, fixture rows straight
into local D1, and a JWT minted with the project's own `createJWT`. Proof of a signed-in app,
taken before anything was measured:

```
$ curl -s -H "Cookie: mn-session=$JWT" http://127.0.0.1:8799/api/auth/me
{"userId":"user-rv","email":"sam.reverify@example.test","name":"Sam Reverifier","avatarUrl":null}
HTTP 200

$ curl -s http://127.0.0.1:8799/api/auth/me          # negative control
{"error":"Unauthorized"}
HTTP 401
```

The dummy-key instrument works exactly as Part 1 describes it and is used the same way below:
one `{"event":"provider_auth_failed","status":401}` line per request that actually reached
`api.anthropic.com`, and its absence is the positive evidence that none did.

### #31 — the match route's `db.batch` (13 → 7 round trips) — **PASS, no behaviour change**

The four cases the brief names, plus two extra probes chosen because they are the only way to
observe from outside that a *specific* value came back from the collapsed batch correctly.

| Case | Result | `provider_auth_failed` |
|---|---|---|
| Reaches the provider (`sess-good`, no caps) | `503` `{"…nap…","kind":"provider_auth"}`, 155 ms | **1** |
| Ex-member (`sess-leave`, after `POST /api/groups/grp-leave/leave` → `{"ok":true}`) | **`403`** `{"…you can still read this evening…","kind":"left_group"}`, 5.5 ms | 0 |
| `MONTHLY_MATCH_LIMIT=0`, Worker restarted, binding confirmed in the banner | **`429`** `{"…lot of requests…","kind":"monthly_cap"}`, 66 ms | **0** |
| Round 11 on a session holding 10 stored rounds | **`429`** `{"…tonight's refinement limit","kind":"round_limit"}`, 5.0 ms | 0 |

Byte-identical bodies and identical statuses to Part 2's measurements on `a60483f`. The control
matters as much as the refusals: `sess-leave` returned `503 provider_auth` **while still a
member** and `403` after leaving, so the 403 is the gate and not an artefact.

Two probes into the batch itself, since "same response" alone would not distinguish a batch that
silently returned the wrong slice:

- **`recommendedTmdbIds` (batch statement 3).** POSTing
  `{"removedTmdbIds":[27205,999999]}` to `sess-good`, whose round 1 recommended 27205 and never
  recommended 999999, logged
  `{"event":"removed_ids_filtered","session_id":"sess-good","submitted":2,"accepted":1}`.
  The provenance set survived the collapse intact.
- **`round` (batch statement 1).** A throwaway session seeded with ten `recommendations` rows
  returned `round_limit` in 5 ms — `toRoundNumber` produced 11 from the batched `COUNT(*)`.

**Stated honestly:** `members` and `accumulatedRemovedIds` are the two batch slices with **no
external observable** short of a successful round — they only ever reach the prompt. Prompt
assembly demonstrably completed (the request reached Anthropic and failed on the key, not
before), which is weak evidence for `members` and none at all for `accumulatedRemovedIds`. Both
are covered by unit tests; neither is proven end to end here, and the blocker is the same
missing Anthropic credential that Part 5 already names as the biggest gap.

### #29 — partial-tolerant profile save — **PASS, including the DB check**

`PUT /api/user/profile` with two known ids and one dud in `comfortTitles`, one known and one dud
in `watchlist`:

```
HTTP 200  time=0.308s
{"profile":{"comfortTitles":[27205,155],"watchlist":[157336],"vibes":["Cozy","Cerebral"],
            "dealbreakers":["Horror"],"streamingServices":["Netflix"]},
 "skippedTitles":[{"tmdbId":999999901,"reason":"unavailable"},
                  {"tmdbId":999999902,"reason":"unavailable"}]}
```

The save **persisted** — a re-`GET` returns the same body — where the old behaviour recorded in
item 8 above was a `400` with the whole edit refused. Tags came through untouched, which is the
point: they have nothing to do with TMDB.

**Checked in D1 directly, which is the claim that actually matters:**

```
profiles(user-rv)          comfort_titles = [27205,155]   watchlist = [157336]
titles WHERE tmdb_id IN (999999901, 999999902)            → 0 rows
```

and, across every profile in the database, the anti-join of both id lists against `titles`
returns **zero dangling references**. A dud id reaches neither `profiles` nor `titles`.

**One case not reachable here:** with a dummy token TMDB answers `401` before it ever considers
the id, so every skip is `reason: "unavailable"`. The `"not-found"` branch (a genuine TMDB 404)
needs a real token and was not exercised — same credential-shaped gap as Part 5.

### #30 — poster `srcset` / `sizes` — **PASS**

Read from the live DOM the Worker served, at `/results/sess-good` → "The picks". All five
posters carry the full ladder:

```
srcset  .../w92/inception.jpg 92w, .../w154/… 154w, .../w185/… 185w,
        .../w342/… 342w, .../w500/… 500w
sizes   (min-width: 40rem) 13rem, 14rem
```

first poster `loading="eager" fetchpriority="high"`, the other four `loading="lazy"` with no
`fetchpriority`, all `decoding="async"`.

**The `sizes` value is honest, which is the part worth measuring** — a `sizes` that disagrees
with the real box makes the browser confidently fetch the wrong variant. Measured
`getBoundingClientRect().width`: **208 px at 1280 wide** (= 13rem, matching the `min-width:
40rem` branch) and **224 px at 375 wide** (= 14rem, the fallback). `currentSrc` resolved to
`w342` in both, the smallest candidate at or above the box at DPR 1. Declaration, layout and
selection agree.

Posters still 404 against `image.tmdb.org` (fixture paths), exactly as in the two earlier
passes; candidate selection happens before the fetch, so this does not affect the reading.

`Poster` has one other call site, `title-search.tsx` with `sizes="2rem"`, and it renders only
inside the TMDB-backed search dropdown — unreachable without a real token, so unverified.

## Part 8 — Observations from this pass

**O-4 — one `GET /api/auth/me` 401 on the first page load after the JWT's 15-minute window
lapsed**, immediately followed by `200`s on reload with no console errors. This is the shape
already documented in `docs/pitfalls/testing-pitfalls.md` §5 (the loser of a refresh-token
rotation race returns `{ user: null }`, and `/profile` fires two such requests at once). Noted
as a live sighting corroborating a known finding; causation was not proven, and it is **not**
attributable to #29, #30 or #31.

**O-5 — `left_group` is only discoverable from a refusal.** The read path serves an ex-member
`200`, so a page load cannot know the viewer has left until something POSTs and fails. The fix
in Part 6 therefore closes the affordance *after* the first 403, not before it — the user gets
exactly one dead click, which is also the click that produces the explanation. Closing it before
the first attempt would need the GET to report membership; that is a server change, out of
scope here, and arguably not worth it.

**Gates:** `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` **63 files / 865 passed /
2 skipped** (baseline 862, +3 for the new tests), only the pre-existing
`vite:dynamic-import-vars` warnings, `npx @opennextjs/cloudflare build` clean.
