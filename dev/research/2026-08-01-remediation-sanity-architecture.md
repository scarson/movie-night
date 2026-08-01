# Phase 1 Remediation — Independent Sanity Review (product / architecture lens)

**Date:** 2026-08-01
**Reviewer role:** independent product/architecture reviewer. Lens: YAGNI, simplicity, blast
radius, fit with the quiet design brief. Context: greenfield, zero users, nothing deployed,
solo developer.
**Base read:** `/Users/sam/Code/movie-night` root checkout, `dev` @ `12865d0`. Read-only.
**Verified against source, not the report.** Every line reference below is my own read.

Inputs read in full: `dev/bug-hunts/2026-08-01-phase1-consolidated.md`, `DESIGN.md`,
`dev/plans/design-doc.md` (privacy/AI-security/refinement sections),
`docs/pitfalls/implementation-pitfalls.md`, `docs/accessibility.md` (disabled/inactive),
`migrations/0001_initial_schema.sql`, `wrangler.jsonc`, `worker.ts`, `package.json`,
and the source at every location I opine on: `src/lib/{auth,matching,movie-sessions,groups,
account,cron-handler,db,tmdb}.ts`, `src/app/api/movie-sessions/[id]/{route,match/route}.ts`,
`src/app/api/{user/profile,titles/search}/route.ts`, `src/app/{ritual,quick,results/[sessionId],
profile,groups}/page.tsx`, `src/components/{control-classes,control-contrast.test,tag-picker,
title-search,taste-map,refine-panel,ranked-list}.tsx`.

Platform facts checked against Cloudflare docs (not memory) and against the installed
`@anthropic-ai/sdk@0.112` sources.

---

## Summary of verdicts

| # | Item | Verdict |
|---|---|---|
| 1 | D1 — candidate filter + ~60 pool floor | AGREE-WITH-CHANGE (filter yes, drop the floor) |
| 2 | D2 — chunk `resolveIds` | AGREE |
| 3 | D3 — ~45s budget in `runMatching` (option C) | AGREE-WITH-CHANGE (take option B, via the SDK's own `timeout`) |
| 4 | D4 — prune `rate_limit_log` in `logJoinAttempt` | AGREE-WITH-CHANGE (scope the DELETE to the index; lowest-value item, first to cut) |
| 5 | D5 — clamp/strip synopsis + guardrail + PROMPT_VERSION | AGREE-WITH-CHANGE (normalise before the regex, not after) |
| 6 | D6 — split fetch/write errors + `.catch` on `waitUntil` | AGREE-WITH-CHANGE (also count rows, not statements) |
| 7 | D7 — chunked `IN()` for profile PUT | AGREE |
| 8 | B1–B15 fix approaches | 6 AGREE, 8 AGREE-WITH-CHANGE, 1 DISAGREE (B11) — details below |
| 9 | `STALE_TITLES_LIMIT` 200 → 40 | DISAGREE (keep 200; verify the plan tier instead) |
| 10 | Canonical disabled treatment | Recommendation below: two-tier slate/ash, no opacity, centralised in `control-classes.ts` |
| 11 | Execution grouping | AGREE-WITH-CHANGE (four concrete overlaps + one hard ordering constraint) |

---

## 1. D1 — candidate filter with a ~60 pool floor

**AGREE-WITH-CHANGE: take option B, drop the floor.**

The structural filter is right and it is the difference between fixing B3's symptom and making
B3 impossible. `selectCandidates` already demonstrates exactly this pattern for discovery mode
(`matching.ts:129-131`), so this is making the codebase consistent with itself, not adding a
mechanism.

The floor is speculative complexity that cannot fire. The pool is `CANDIDATE_POOL_SIZE = 250`
narrowed to `CANDIDATE_CAP = 200` (`matching.ts:22-23`). The round cap is 10
(`match/route.ts:24`) and each round returns 5-7 picks (`matching.ts:267`), so the accumulated
removal set is bounded at ~70 — and the client only ever sends 50
(`results/[sessionId]/page.tsx:221-223`). To drive the pool under 60 you would need ~140
exclusions, i.e. twenty rounds against a ten-round budget. A branch that can never execute is a
branch that can never be tested, and it introduces a *worse* intermediate state than either
extreme: "some removed titles are back in the pool, chosen by no rule."

The failure mode the floor is guarding against already has a first-class handler:
`MIN_SURVIVING_RECOMMENDATIONS = 3` → `thin_results` → a UI framing that says "loosen a
dealbreaker" (`results/[sessionId]/page.tsx:58-61`). That is the correct response to an
over-constrained brief, and it is honest.

Implementation note: apply the filter to the whole pool *before* the referenced/fill split at
`matching.ts:136-141`, not just to `fill`. A title on a member's own watchlist that they rejected
this session must still be excluded — "never return" has no exception for "but it's on your list".

---

## 2. D2 — chunk `resolveIds`

**AGREE.** Verified `MAX_RESOLVED_IDS = 100` (`titles/search/route.ts:13`) against a hard D1
ceiling of 100 bound parameters, with `.bind(...ids)` and zero headroom
(`titles/search/route.ts:53-65`). `D1_IN_CHUNK_SIZE = 90` exists precisely because "90 leaves
headroom for any fixed params in the same query" (`db.ts`). This is the one remaining exception
to the pattern PLAT-1 was written about after it caused a real production `500 "Match failed"`.

No behaviour change: `resolveIds` re-imposes caller order in the final `ids.map(...)`, so
chunking cannot reorder anything. ~6 lines.

---

## 3. D3 — wall-clock deadline

**AGREE-WITH-CHANGE: bound each call (option B), and do it with the SDK's own `timeout`, not a
hand-rolled deadline in `runMatching`.**

The report's own numbers understate the problem. I read the installed SDK: the default client
timeout is **10 minutes** (`@anthropic-ai/sdk/src/client.ts:500,548`), and its own doc comment
warns "request timeouts are retried by default, so in a worst-case scenario you may wait much
longer than this timeout" (`client.ts:376-377`). With `maxRetries: 1` (`matching.ts:390`), a
single hung call can occupy the Worker request for **~20 minutes**. Cloudflare imposes no
backstop — "There is no set time limit on individual subrequests. As long as the client remains
connected, the Worker can continue making subrequests" (Workers platform limits).

Option C (refuse to start app attempt 2) does not touch that case at all: `runMatching` only
retries on `malformed` (`matching.ts:522`), so the 20-minute hang is inside a *single* attempt
that option C never gets to veto. It bounds the multiple and leaves the worst single case
unbounded.

The fix is one line and needs no deadline threading:

```ts
const defaultClientFactory: MatchingClientFactory = (apiKey) =>
  new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
```

`APIConnectionTimeoutError extends APIConnectionError`
(`@anthropic-ai/sdk/src/core/error.ts:125`), which `callClaude:426` already maps to
`MatchingError("timeout")` — so the locked `MATCHING_ERROR_HTTP` contract and `ERROR_FRAMING`
are untouched, which was the report's stated reason for preferring C.

Caveat to state in the plan: the SDK retries timeouts, so `timeout: 45_000` with
`maxRetries: 1` is ~95s worst case, not 45s. If Sam wants a hard ceiling, set `maxRetries: 0` —
`runMatching`'s own retry already covers the malformed case, and the SDK's retry only buys an
automatic second try on transient 5xx/429, which the taxonomy already surfaces to the user as
"try again in a moment".

---

## 4. D4 — prune `rate_limit_log`

**AGREE-WITH-CHANGE, with a caveat, and this is the item I would cut first if scope tightens.**

This is not a bug at any volume this app will see in Phase 1: `logJoinAttempt` writes one row per
*group join attempt*, and joining a group is a once-per-relationship act. The table will hold
double-digit rows. The report says as much itself.

If it's done anyway (3 lines, can't drift, fine), one required change: scope the DELETE to the
same `(scope, key)` the insert uses, so it hits `idx_rate_limit_scope_key(scope, key, at)`:

```sql
DELETE FROM rate_limit_log WHERE scope = ? AND key = ? AND at < <window>
```

An unscoped `at < window` delete is a full table scan on every join — irrelevant now, and
precisely the thing that bites when the table is finally big enough to matter.

Also note in a comment that this destroys the only record of invite-code enumeration attempts.
Nothing reads it today so that is acceptable, but the join route's own comment
(`groups/join/route.ts:51-52`) presents the log as an anti-enumeration mechanism, and a future
reader deserves to know the history is gone.

---

## 5. D5 — synopsis clamp + newline strip + guardrail + `PROMPT_VERSION`

**AGREE-WITH-CHANGE: normalise whitespace *before* the sentence match, not after.**

Both facets verified at `matching.ts:193-196`. `match[0]` is genuinely unclamped and it is the
only prompt input not bounded by construction — every other one goes through
`clampText`/`clampTags`/`clampTitleList`.

The report's fix patches the fall-through branch's output. Cleaner: kill the branch. `.` not
matching `\n` is the *cause* of both facets; collapse whitespace first and the sentence regex
behaves, then clamp both branches:

```ts
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = flat.match(/^.*?[.!?](?=\s|$)/);
  return clampText(match ? match[0] : flat, 160);
}
```

Same two lines, one behaviour instead of two. Guardrail extension and `PROMPT_VERSION` bump:
agree — `PROMPT_VERSION` is persisted per round (`movie-sessions.ts:345`) for exactly this, it
costs nothing, and `src/lib/matching.eval.test.ts` exists and should be re-run.

---

## 6. D6 — cron observability

**AGREE-WITH-CHANGE: also count rows written, not statements queued.**

Both defects verified (`cron-handler.ts:48-52, 78-80`; `worker.ts:16`). Option B is right-sized.

But the report notes `refreshed += batch.length` counts statements, not rows matched
(`cron-handler.ts:49`) and then leaves it out of the fix. That defeats D6's own stated purpose —
"it is a precondition for verifying any B6 fix in production". `db.batch` returns `D1Result[]`
with `meta.changes`; summing it is two lines and makes `refreshed` mean what its name says:

```ts
const results = await db.batch(batch);
refreshed += results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
```

One correction to the report's framing: a `waitUntil` rejection is not literally invisible.
`wrangler.jsonc` has `observability.enabled: true` with `invocation_logs`, so the scheduled
invocation records an `exception` outcome. A named `cron_failed` line is still worth the two
lines — you shouldn't have to go looking — but "no signal at all" overstates it, and plans built
on overstated premises tend to grow.

---

## 7. D7 — chunked `IN()` for the profile PUT

**AGREE.** Verified at `user/profile/route.ts:118-126`: a sequential `for` loop of
`SELECT 1 FROM titles WHERE tmdb_id = ?`, up to 100 iterations, blocking the ritual's
"Continue →" (`ritual/page.tsx:132`). One chunked `IN (...)` over `chunk`/`D1_IN_CHUNK_SIZE`
removes up to 99 round-trips from the most latency-visible button in the flow. The existing
statement carries a fixed `content_type = 'movie'` parameter, which is exactly why the shared
constant is 90 and not 100.

Landing it "in the same change as D2" is fine but not important — they're different files with
no shared code. What matters is that both go through `chunk`/`D1_IN_CHUNK_SIZE`.

---

## 8. Per-bug fix approaches (B1–B15)

### B1 — refresh rotation race — **AGREE-WITH-CHANGE (two cheaper shapes the report didn't consider)**

The bug is real and the reachability chain checks out (`auth.ts:188` pins the session cookie to
`Max-Age=900`; `auth-provider.tsx:49` has an empty dep array; `ritual/page.tsx:75-79` fans out
three authenticated requests).

The report's preferred option (a) — a `replaced_by`/`rotated_at` column and a grace window — is
the textbook refresh-token-reuse-detection shape, and it is also the single largest change in
this campaign: a migration, a new token lifecycle, a new security surface (a window in which a
stolen token still works), and a rewrite of the test that currently pins the behaviour
(`auth.test.ts:375`). That is a lot of machinery for an app with zero users.

Two smaller shapes exist, and Sam should pick between them explicitly:

1. **Grace row on the existing schema, no migration.** After the winning
   `DELETE ... RETURNING`, `db.batch([INSERT new session, INSERT old token_hash with a ~30s
   expires_at])`. `sessions` already has `token_hash` PK / `user_id` / `expires_at` — nothing new
   is needed. Losers claim the grace row and rotate again; each response sets its own cookie and
   the last one home wins, which is already true of any grace-window design.

2. **Stop rotating; extend in place.** Replace destroy-then-recreate with
   `UPDATE sessions SET expires_at = ? WHERE token_hash = ? RETURNING user_id, expires_at`.
   Idempotent, so all N concurrent requests succeed; no cookie churn on the refresh token; and it
   **eliminates B4 entirely** rather than mitigating it, because there is no window in which the
   session does not exist. Roughly five lines.

   The trade is real and belongs to Sam: rotation-on-refresh shortens the window a leaked refresh
   token stays useful. But the current implementation derives *no detection* benefit from
   rotation — `auth.ts:120-125` deliberately treats an unknown token as "nothing happened" — so
   today you are paying the race and the B4 window for a property you aren't collecting on.

My recommendation: (2), unless Sam wants to build reuse detection in Phase 1, in which case (a)
is the right foundation and should be scoped as its own piece of work rather than a bug fix.

### B2 — leaving a group doesn't revoke match authority — **AGREE**

The fix is in the right place. Verified that pushing it into `getSessionForMember` would close
the history read the design doc explicitly preserves (`design-doc.md:275`), and that gating only
the match POST leaves the read path intact. Solo sessions are unaffected because the creator is
always a member of their own `__solo__` group. `groups.test.ts:206` keeps passing.

Two small things to specify, or they'll be improvised badly:

- Give the 403 a `kind` and add it to `ERROR_FRAMING`
  (`results/[sessionId]/page.tsx:50-61`). Without one it falls to `DEFAULT_FRAMING` = "That
  didn't work" **with `retry: true`** — a retry button that can only ever fail again. The map
  already carries non-`MatchingError` kinds (`monthly_cap`, `round_limit`), so this is in-pattern.
- The user-facing copy should say what happened ("You've left this group") rather than a generic
  refusal, because the user *can* still read the session — an unexplained refusal next to visible
  content reads as a bug.

### B3 — removed list truncated from the wrong end — **AGREE-WITH-CHANGE**

Both halves verified. But **part (1) as stated does not fix the bug.** Adding
`ORDER BY round_number DESC` to `getAccumulatedRemovedIds` (`movie-sessions.ts:126-129`) puts the
newest *prior* rounds first, and then `match/route.ts:117-119` appends **this round's** removals
at the end of the union:

```ts
const allRemovedIds = [...new Set([...(await getAccumulatedRemovedIds(db, id)), ...removedTmdbIds])];
```

so the entries the user just rejected are still the first thing `clampTitleList`'s `slice(0, 50)`
throws away. The union order must flip too:
`[...new Set([...removedTmdbIds, ...accumulated])]`. Both changes, or neither works.

Sequencing note: once D1's structural filter lands, part (1) is belt-and-braces rather than the
fix. Still worth doing — the prompt line is user-visible reasoning — but it should be described
that way so nobody treats the ORDER BY as sufficient.

### B4 — transient D1 write destroys the session — **AGREE-WITH-CHANGE**

The try/catch-and-clear-cookies fix is right and cheap: it converts "permanently wedged at 401
until you clear cookies manually" into "cleanly signed out", which is a strictly safe direction.

The report's "better still: issue the replacement row in the same `db.batch` as the delete" does
**not** work as written. The `INSERT` needs `user_id`, which only arrives via the `DELETE ...
RETURNING`; and batching an unconditional `INSERT` behind a `DELETE` that matched zero rows
destroys the single-winner property B1's whole design rests on — both concurrent callers would
succeed and both would mint sessions. Drop that sentence from the plan.

Order B1 before B4 in the same group, and re-scope B4 after B1 lands: under B1 option (2) there
is no destroy-then-recreate window and B4 has nothing left to fix.

### B5 — deleted user's name persists in `ai_response` — **AGREE-WITH-CHANGE (decide it now, and decide small)**

Leaving this as an open scope decision is the wrong call for a greenfield app. Decide:

- **Do** the render-time placeholder. `getSessionMembersWithProfiles` already drops deleted users
  via `JOIN users` (`movie-sessions.ts:234`), so the session GET can return the set of live member
  userIds and `<TasteMap>` can render "Former member" for any `tasteMap.members[].userId` not in
  it. One additive field, one consumer (`results/[sessionId]/page.tsx:346`), ~10 lines.
- **Do** correct the copy — `profile/page.tsx:235`, `privacy/page.tsx:90`, and
  `design-doc.md:62`. At zero users the promise costs nothing to weaken and everything to keep
  falsely. Say what is true: the name is removed from taste maps, and earlier written summaries
  may still mention it.
- **Do not** build a delete-time scrubber over stored `ai_response` blobs. It means reading every
  recommendation row for that user's sessions, JSON-parsing, regex-replacing a name out of free
  prose, and writing back — inside a Worker, over an unbounded row set, irreversibly, to satisfy a
  sentence you are free to rewrite. That is the most expensive and least reliable option on the
  table.

The `conversational` tab is the residual either way; the copy must not claim otherwise.

### B6 — weekly refresh starves the tail — **AGREE-WITH-CHANGE (two changes, one of them important)**

**Ordering.** Prefer `ORDER BY last_refreshed_at ASC, popularity DESC` over the report's
either/or "oldest-first *or* split the budget". SQLite sorts NULLs first on `ASC`, so
never-refreshed rows lead; `popularity DESC` is then a within-run tiebreaker, which preserves the
thing popularity ordering was actually for (`selectCandidates` only ever surfaces the popularity
head). One clause, no budget-splitting arithmetic.

**Failure marking — do not stamp `last_refreshed_at`.** This is the part I'd flag hardest. The
report proposes "record an attempt timestamp ... on the error path". `last_refreshed_at` is
rendered to the user: `asOfNote(title.lastRefreshedAt, now)` prints
*"as of 4 Jul 2026"* on a pick's streaming line (`ranked-list.tsx:34-42`, called at `:137`).
Stamping it on a *failed* fetch makes the UI assert a freshness that never happened — turning an
observability gap into a user-facing lie, on exactly the field the design doc's "where to watch
info that's actually correct" criterion is about.

Correct shape: add `last_refresh_attempt_at TEXT` to `titles` (migration `0003`), drive the
staleness predicate off it, and stamp it on both success and failure. A migration is free at zero
users. The alternatives are worse: stamping `last_refreshed_at` lies to the user, and repurposing
the unused `updated_at` column is exactly the naming-by-history that CLAUDE.md forbids.

### B7 — `MONTHLY_MATCH_LIMIT=0` — **AGREE**

One line, one route, zero risk, and it's the one value that expresses "kill switch armed".
Verified at `match/route.ts:105`. Reject negatives too:
`Number.isNaN(parsed) || parsed < 0 ? DEFAULT : parsed` — `-1` currently reads as "unlimited" by
accident, which is the same class of bug pointing the other way.

### B8 — false weighting note — **AGREE-WITH-CHANGE (the proposed field is a privacy regression)**

The bug is real (`results/[sessionId]/page.tsx:350` vs `matching.ts:205-208`). The proposed fix
is not safe as specified.

`weightingApplied: boolean` on `SessionView` is serialised to **every** member by
`movie-sessions/[id]/route.ts:45`. In a two-person group, a member who did not toggle and reads
the JSON learns that `weightingApplied === true`, and therefore that their partner toggled. That
is precisely the invariant DESIGN.md §Rough-Day Toggle protects ("The generosity stays
invisible", line 122-124) and that VC5 verified was intact. The fix would reintroduce, over the
wire, the exact leak the design doc's 2026-07-19 decision-log entry was written to close.

Serialise the already-ANDed value instead — a boolean that can only ever be true for the person
who set the flag:

```ts
weightingNoteVisible: ownRoughDay && toggledCount > 0 && toggledCount < liveMemberCount
```

and gate the note on that alone. Name it for the thing it controls, not for engine internals.

**Hard coupling:** `liveMemberCount` must be the *users-joined* count B9 introduces, or B8
re-creates B9's bug in a second place: the engine's `toggledCount === members.length` check runs
over `getSessionMembersWithProfiles`, which drops deleted accounts. B8 and B9 are one change.

### B9 — `member_count` counts anonymised deleted members — **AGREE**

Verified `movie-sessions.ts:173` vs `:234`. The proposed subquery is correct and minimal, moves
both callers in the right direction, and `movie-sessions.test.ts:365-398` keeps passing. Make it
the single source of truth that B8 consumes.

### B10 — pickers enforce no count limit — **AGREE-WITH-CHANGE**

The fix is right and copies a pattern already in the repo (`quick/page.tsx:94-106, 244-250`:
refuse the tap, say why, `aria-live`). Verified the 30-preset arithmetic
(`config/tags.ts`: 16 `MOOD_TAGS` + 14 `GENRE_TAGS`) against `MAX_TAG_LIST_ENTRIES = 30`.

Change: don't add a fourth and fifth copy of the limits. `50` and `30` are already duplicated
across `matching.ts:20-21`, `user/profile/route.ts:11-12`, and `match/route.ts:26`. Extract them
to a small `src/config/limits.ts` and import from there. CLAUDE.md's "work hard to reduce
duplication" outranks YAGNI here because the alternative is *expanding* an existing duplication
in the same change that draws attention to it. (See §11 — this makes the file cross-group, so do
the extraction as a prep step.)

### B11 — duplicate session via "Back to the mood" — **DISAGREE**

The report prefers "have `submit()` reuse an existing `sessionId`" and deprecates "clear
`sessionId`". I'd take the deprecated one.

`movie_sessions.mood_vibes` / `mood_text` / `discover_new` are written once at creation
(`movie-sessions.ts:89-101`) and never updated. `runMatch(sessionId)` re-runs the *stored* brief.
So reusing the session id means: the user presses "Back to the mood" (on `/quick` the button is
literally **"Change the vibe"**, `quick/page.tsx:186`), changes their tags, presses the CTA, and
gets a match against the vibe they just abandoned — silently. That trades a cheap orphan row for
a wrong answer, which is a bad trade in a product whose entire value is the answer.

Clear `sessionId` on the way back (`ritual/page.tsx:217-220`, `quick/page.tsx:181-190`). The
"but the round budget resets" objection isn't a defect: a new mood is a new brief, and
`getRoundNumber` counting per-session is the correct granularity for it. The only alternative
that preserves both properties is a session-mood PATCH endpoint, which is over-engineered for
Phase 1.

### B12 — paid round discarded — **AGREE-WITH-CHANGE (drop the insert retry)**

The `getTitlesMap` try/catch → `{}` is right and free: `ranked-list.tsx:129-132` already renders
`pick ${index + 1}` for an unhydrated title, so partial data is contract-compatible.

Drop "retrying the insert once is cheap and proportionate". `insertRecommendation` mints a fresh
`crypto.randomUUID()` PK (`movie-sessions.ts:337`), so a retry after a commit-then-lost-response
writes the round **twice** — inflating `getRoundNumber`, `getAccumulatedRemovedIds`, and the
monthly cap. A blind retry of a non-idempotent insert on the app's only spend path is the riskiest
line in the whole plan. Log the serialised response so the round is recoverable, and stop.

(If the retry is wanted later, make it idempotent first by keying `recommendations.id` on
`${sessionId}:${round}`. Pleasant side effect: it converts the accepted round-limit TOCTOU into a
PK conflict. That's a separate decision, not part of B12.)

### B13 — `tasteMap.overlap` unvalidated — **AGREE**

Additive validation, one shared predicate across write and read paths, and the degraded state
already renders well (`response: null` → "Nothing picked yet" with a working CTA,
`results/[sessionId]/page.tsx:238-263`). Verified there is no `error.tsx`/`global-error.tsx`
anywhere under `src/app/`, so an unguarded render throw does land on Next's built-in boundary.

One implementation detail worth pinning: the read path dereferences before it validates —
`route.ts:39-41` calls `response.recommendations.map(...)` immediately after
`parseJsonColumn`. The guard has to sit between those two lines, not merely "somewhere in the
route".

### B14 — orphaned groups after account deletion — **AGREE-WITH-CHANGE (do both (a) and the copy)**

Option (a) alone does not make the copy true. A shared group with a surviving member is correctly
*not* deleted, so *"This deletes your profile, your groups and your sign-in"*
(`profile/page.tsx:233`) still overstates. Do (a) **and** correct the copy — "any group only you
were in".

And (a) is not a one-statement addition to the existing batch. `group_members` cascades away as
part of the `DELETE FROM users` in that same batch (`account.ts:8-16`), so by the time a
"which groups are now empty" statement runs, the membership rows that identify *this user's*
groups are gone. The shape is: `SELECT group_id FROM group_members WHERE user_id = ?` **before**
the batch, then a scoped
`DELETE FROM groups WHERE id IN (...) AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = groups.id)`.
The `NOT EXISTS` guard is load-bearing: `movie_sessions.group_id` is `ON DELETE CASCADE`
(`0001_initial_schema.sql`), so getting the predicate wrong destroys a surviving partner's entire
history.

The `__solo__` guard in `leaveGroup` is two lines and worth it. Agreed.

### B15 — duplicate `__solo__` groups — **AGREE-WITH-CHANGE (make the id deterministic, not the invite code)**

The report's shape — deterministic `invite_code` + `INSERT OR IGNORE` + re-`SELECT` — has a
problem. If you keep the random `groups.id` and batch the two inserts, the loser's
`group_members` row references a group id that was never written; `group_members.group_id
REFERENCES groups(id)` and D1 enforces foreign keys, so the whole batch fails. Avoiding that
forces a three-step non-batched sequence.

Make the **primary key** deterministic instead — `solo-${userId}` — and both statements become
idempotent on constraints that already exist (`groups.id` PK, `UNIQUE(group_id, user_id)` on
`group_members`, both in `0001_initial_schema.sql`):

```ts
await db.batch([
  db.prepare("INSERT OR IGNORE INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(groupId, SOLO_GROUP_NAME, `solo-${userId}`, now),
  db.prepare("INSERT OR IGNORE INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), groupId, userId, now),
]);
```

No re-read, no migration, no FK hazard. The only exposure is that a solo group's id embeds its
owner's user id and `SessionView.groupId` is serialised — but a solo group has exactly one
member, so the only person who can see it is the person whose id it is. `solo-${userId}` still
fails the 8-char `CODE_FORMAT` at `groups/join/route.ts:9`, so unjoinability is preserved.

**Skip the client-side double-submit guard.** `submit()` calls `setMatching(true)` first
(`quick/page.tsx:119-121`), which re-renders into the `PhasedLoading` branch and unmounts the
button; React 18 has committed long before a human's second tap lands. The window is
sub-frame — the server-side fix is the fix, and adding a `disabled` state here just creates one
more call site for §10 to normalise.

### Bugs I would consciously **not** fix now

- **D4** — not a bug at any Phase 1 volume, by the report's own analysis. First thing to cut.
- **B15's client-side guard half** — reasoning above; the server fix subsumes it.
- **B5's stored-blob scrubber option** — decide it out of scope explicitly rather than leaving it
  as an open branch someone picks up later.

Everything else in B1–B15 should land. Nothing in the set is expensive enough to be worth
carrying as known-broken into a first deploy, and several (B7, B9, B13) are single-digit-line
changes with zero blast radius.

---

## 9. `STALE_TITLES_LIMIT` 200 → 40

**DISAGREE. Keep 200; answer the plan-tier question instead of pricing in the worst case.**

Facts I checked rather than assumed:

- **The stated premise is stale.** Cloudflare's limits page and the 2026-02-11 changelog: Workers
  Paid now defaults to **10,000** subrequests per invocation (configurable to 10M), not 1,000.
  The code comment at `cron-handler.ts:6-9` is out of date and should be corrected regardless of
  what happens to the number.
- **Free is 50 *external* subrequests** (plus 1,000 to Cloudflare services). `fetchMovieDetail`
  uses `append_to_response=keywords,credits,watch/providers` (`tmdb.ts:245-252`), so it is exactly
  one external fetch per title. 200 titles = 200 external subrequests. The concern is directionally
  real on Free.
- **But the Free-plan failure is graceful, not run-killing.** `Too many subrequests` is thrown by
  `fetch`, and the per-title `catch { errors++ }` at `cron-handler.ts:78-80` already swallows it.
  A Free-plan run refreshes ~49 titles and logs ~151 errors. With D6's fetch/write split that is a
  loud, self-diagnosing signal in the very first cron log line — which is exactly what you want
  from an unknown. "Every cron run fails mid-run" overstates it.
- **The app is Paid-only by construction anyway.** Workers Free caps CPU at **10 ms per
  invocation**. An OpenNext Next.js SSR render, plus `buildMatchingPrompt` over 200 candidates and
  a `JSON.parse` of a 16k-token response, is not a 10 ms workload. If this account is on Free, the
  cron limit is not the problem you'll be debugging.
- **The cost of 40 is permanent and lands on the exact thing B6 is being fixed for.** The seed is
  `DEFAULT_PAGES = 50` ≈ 1,000 titles (`scripts/seed.ts:19`). With an oldest-first sweep, 200/week
  clears the catalog in ~5 weeks; 40/week takes ~25. `asOfNote` (`ranked-list.tsx:34-42`) starts
  printing "as of <seed date>" after a fortnight, so at 40 most of the catalog carries a staleness
  stamp essentially forever. You would be fixing B6 and then re-breaking its outcome in the same
  commit.

The asymmetry is clear: guessing wrong toward 200 costs one noisy cron log on a plan the app
can't run on anyway; guessing wrong toward 40 costs the catalog-freshness goal permanently. And
the question is answerable in one dashboard glance by the account owner, before deploy — which
the existing code comment already flags as a deploy-time item.

**Recommendation:** keep `STALE_TITLES_LIMIT = 200`, fix the stale comment to say
"Free caps external subrequests at 50/invocation; Paid defaults to 10,000", and keep "confirm the
plan tier" as a pre-deploy checklist item rather than a code change. If Sam wants belt-and-braces
without the freshness cost, the honest version is a second cron trigger rather than a smaller
limit — but that is Phase 2 thinking and not needed now.

---

## 10. Canonical disabled treatment for the amber-fill button

### What is actually there

Verified six treatments across six files:

| Site | Treatment |
|---|---|
| `groups/page.tsx:224,226,324` | `disabled:opacity-50` (outlined, filled, ember) |
| `groups/join/[code]/page.tsx:11` | `disabled:opacity-50` (filled) |
| `ritual/page.tsx:337` | `disabled:opacity-60` (filled) |
| `profile/page.tsx:27` | `disabled:bg-slate disabled:text-ash` (filled) |
| `profile/page.tsx:264` | `disabled:border-slate disabled:text-ash disabled:hover:…` (ember outlined) |
| `refine-panel.tsx:111` | `disabled:border-slate disabled:bg-transparent disabled:text-ash` (filled, rendered as outline) |

Plus eleven `primaryButtonClasses` / `primaryControlClasses` sites with no disabled treatment at
all — most are `<Link>`s or buttons that are never disabled today, but `refine-panel`'s
regenerate and any future guarded CTA are not.

### What DESIGN.md already decides for you

- The amber hierarchy is **three levels**: fill (CTAs), border/outline (selected/active),
  text-only (tertiary) — `DESIGN.md:51`, decision-log 2026-03-30.
- `slate` is **"Borders, subtle dividers"**, and the 2026-07-27 decision makes it explicit:
  *"`slate` is for what the criterion does not govern — dividers, panel edges, hover washes, and
  disabled controls"* (`DESIGN.md:132`, echoed at `docs/accessibility.md:31-32`).
- `ash` is the **active** control boundary (6.21:1 / 5.44:1).
- WCAG 1.4.3 and 1.4.11 both exempt inactive components, so contrast is a legibility judgement
  here, not a conformance gate. For the record I computed `ash` on `slate` = **4.06:1** — below the
  4.5:1 text floor that does not apply, comfortably legible, and consistent with
  `control-contrast.test.tsx`, which already asserts `contrastRatio(ash, slate) ≥ 3` for the
  switch knob.

### Recommendation — one rule, two levels, no opacity

> **A disabled control leaves the amber hierarchy.** It is not a dimmed CTA; it is chrome. Filled
> controls drop the amber fill to `slate` with an `ash` label. Outlined controls drop the `ash`
> boundary to `slate` with an `ash` label. Hover is neutralised. Opacity is never used to express
> disabled.

```ts
/** Disabled leaves the amber hierarchy entirely: the control becomes chrome. */
export const disabledFillClasses =
  "disabled:bg-slate disabled:text-ash disabled:hover:bg-slate";
export const disabledOutlinedClasses =
  "disabled:border-slate disabled:text-ash disabled:hover:border-slate";
```

folded into `primaryButtonClasses` / `primaryControlClasses` and `secondaryButtonClasses` /
`compactOutlinedButtonClasses` in `src/components/control-classes.ts`.

Why this and not `disabled:opacity-50` (the current plurality):

1. **It reuses the token semantics the design system already has.** `slate` = inactive, `ash` =
   muted text. Opacity is a mechanical dimming that exists outside the token vocabulary, and
   nothing in DESIGN.md can tell you whether 50 or 60 is right — which is exactly why there are
   two values in the codebase today.
2. **It matches the aesthetic brief.** "Amber is the candlelight." A 50%-opacity amber slab is
   still the loudest object on a midnight screen; it reads as *broken*, not *not yet*. Dropping to
   slate makes the button recede, which is what "unhurried clarity" wants.
3. **It is the treatment DESIGN.md's own accessibility decision anticipated** — the 2026-07-27
   entry names disabled controls as the sanctioned home for `slate`. The two sites already using
   it (`profile/page.tsx:27`, `refine-panel.tsx:111`) are the ones that read the design system.
4. **Two levels, not one, because the resting states differ.** Applying `bg-slate` to an outlined
   button would invent a filled state on a control that has none; applying `border-slate` to a
   filled button does nothing. The rule is the same — *drop out of the hierarchy* — expressed in
   each level's own vocabulary. That is a two-tier scheme falling out of the existing three-tier
   model, not a new axis.

`refine-panel.tsx:111`'s current treatment (`border-transparent` +
`disabled:border-slate disabled:bg-transparent disabled:text-ash`) is the closest thing to a
considered answer already in the tree and is essentially the fill rule with an outline finish;
folding it into the shared string is a simplification, and it stops being the only button that
knows the answer.

### Required companion edits (easy to miss, will fail CI if missed)

- **DESIGN.md**: add a "Disabled controls" line under §Color → Accents (or a short subsection),
  plus a Decisions Log row — the doc's own convention is that state decisions get logged.
- **`src/components/control-contrast.test.tsx`**: the `ALLOWED` map counts `-slate` occurrences
  **per file** and asserts exact equality. Centralising moves counts:
  `app/profile/page.tsx` 3 → 1, `components/refine-panel.tsx` 2 → 1, and
  `components/control-classes.ts` gains 2 (it is currently absent from the map). The test fails
  loudly, which is the point — but the plan must say so, or the UI group will spend an hour on it.
- Delete `disabled:opacity-50` / `disabled:opacity-60` from all five sites; the shared strings
  replace them.
- The `disabled:hover:*` neutralisers matter: `:hover` still matches disabled buttons, and
  `hover:bg-warm-white` vs `disabled:bg-slate` is resolved by Tailwind's variant *order*, not
  specificity (unlike the resting `bg-amber` case the `control-classes.ts:61` comment describes).
  Encoding it once, with a test, is precisely why this belongs in the shared string rather than at
  call sites.

---

## 11. Execution grouping

**AGREE-WITH-CHANGE.** The six-group split is broadly sound — auth, cron, and chunking are clean,
well-bounded units. But four files are owned by more than one group, and one pair of bugs cannot
be split at all.

### Hard constraint: B8 and B9 are a single change

B8's `weightingNoteVisible` must be computed against the same users-joined member count B9
introduces. Split across groups, whichever lands first either blocks the other or ships a second
copy of B9's bug. B8 is a `movie-sessions.ts` + session-GET change with a one-line UI consumer —
move it out of the UI group into the sessions group.

### File overlaps the grouping misses

| File | Groups touching it | Notes |
|---|---|---|
| `src/lib/movie-sessions.ts` | matching (B3), sessions (B5, B9, B15), UI (B8) | Four groups, one file. After moving B8 to sessions: two. |
| `src/app/api/movie-sessions/[id]/route.ts` (56 lines) | sessions (B5), UI (B8), matching (B13) | Three groups, one small file. |
| `src/app/api/movie-sessions/[id]/match/route.ts` | sessions (B2), matching (B3, B7, B12, D1, D3) | B2's only fix site is this file. Move B2 to the matching group; its other touch is one new helper in `groups.ts`. |
| `src/components/control-classes.ts` + the slate allowlist | §10 normalisation, plus any group that adds a `disabled` button | §10 is in no group today. It must be its own item and the **only** thing editing that file and `control-contrast.test.tsx`. |

### Other ordering constraints not stated

- **B1 → B4.** Same file, same group, but the order matters: under B1 option (2) (in-place
  `UPDATE`) B4 has nothing left to fix. Re-scope B4 after B1 lands rather than implementing both.
- **D1 → B3.** Once the structural filter exists, B3's ORDER BY is belt-and-braces. Same group;
  just describe it accurately so nobody stops at the ORDER BY.
- **Migration numbering.** B6 (my recommendation) needs `0003` for
  `titles.last_refresh_attempt_at`; B1 option (a), if chosen, needs one too. Two groups both
  claiming `0003` is a guaranteed merge conflict. Allocate numbers up front.
- **`src/test/fake-d1.ts` failure injection.** B4's and B12's catch tests both need
  statement-level failure injection, and the harness has none today (the consolidated report's
  Test Gap Analysis says so for both). That is one shared test-harness change spanning the auth
  and matching groups — land it once, first.
- **`src/config/limits.ts`** (if B10's constant extraction is taken) is imported by `matching.ts`,
  `user/profile/route.ts`, `match/route.ts` and two components — four groups. Do the extraction as
  a prep step, or accept the duplication in the UI group and leave the other three alone.

### Suggested regrouping

```
G0  prep      fake-d1 failure injection · migration numbers allocated · (opt) src/config/limits.ts
G1  auth      B1 → B4                                        [src/lib/auth.ts]
G2  cron      B6 (+ migration 0003) · D6                     [cron-handler.ts, worker.ts]
G3  chunking  D2 · D7                                        [titles/search, user/profile routes]
G4  sessions  B9+B8 (one change) · B5 · B14 · B15 · D4       [movie-sessions.ts, account.ts, groups.ts, session GET]
G5  matching  B2 · B3 · B7 · B12 · B13 · D1 · D3 · D5        [matching.ts, match/route.ts, session GET (B13 read path)]
G6  ui        §10 disabled normalisation FIRST, then B10 · B11
```

G1, G2, G3 are independent and can run in parallel after G0. G5 runs after G4 (both touch the
session GET route; G5 owns the `isMatchingResponse` predicate that its read-path half needs, so
giving G5 the whole of B13 and sequencing it second is simpler than splitting the predicate out).
G6 runs whenever, but §10 must land before B10/B11 inside it.

---

## Closing note

The report is unusually good — the corrections it makes to its own hunters (B6 mechanism B, FP1,
FP3) are the mark of a consolidator who actually re-read the code. My disagreements are
concentrated in three places, and they share a shape: a proposed fix that is correct about the
bug but introduces a second, quieter problem.

1. **B8's `weightingApplied`** would put the rough-day secret on the wire — the one privacy
   invariant DESIGN.md has a decision-log entry about.
2. **B11's preferred option** would make "Change the vibe" not change the vibe.
3. **B6's failure-stamping** would make the "as of" note lie to the user.

Plus one scope call I'd push back on hard: **dropping `STALE_TITLES_LIMIT` to 40** prices in a
worst case that the app's own CPU requirements make nearly impossible, and pays for it with the
freshness goal B6 exists to protect.
