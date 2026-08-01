# Independent sanity/security review — Phase 1 remediation decisions

**Date:** 2026-08-01
**Reviewer:** independent (correctness / security / privacy / data integrity lens)
**Base reviewed:** `/Users/sam/Code/movie-night` @ `12865d0` (dev), read-only
**Inputs:** `dev/bug-hunts/2026-08-01-phase1-consolidated.md`, `docs/pitfalls/implementation-pitfalls.md`,
`migrations/0001_initial_schema.sql`, and the source at every cited location (verified myself, not taken
from the report).

**Platform facts I verified against Cloudflare docs before opining** (these change several answers):

- **`db.batch()` is transactional.** "Batched statements are SQL transactions. If a statement in the
  sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the
  entire sequence." (`/d1/worker-api/d1-database/`). Statements execute sequentially, non-concurrently.
- **Subrequest limits changed on 2026-02-11.** Free plan is now **50 *external* subrequests + 1,000
  subrequests to Cloudflare services** per invocation. Paid default is 10,000 (configurable to 10M via
  `limits.subrequests`). D1 calls are *internal* and do **not** compete with TMDB fetches.
- **HTTP-triggered Workers have no wall-clock duration limit** ("No hard limit while the client remains
  connected"). CPU time is the limit: Free **10 ms**, Paid **30 s default** (up to 5 min via
  `limits.cpu_ms`). Awaiting a subrequest does not consume CPU time. Cron Triggers: 15 min wall,
  Free 10 ms CPU / Paid 30 s (interval < 1h) or 15 min (interval ≥ 1h).
- **D1 enforces foreign keys by default** (`PRAGMA defer_foreign_keys` exists precisely to suspend them).
- **Anthropic TS SDK:** `timeout` default is **10 minutes**, and the TS SDK *scales the default up to
  60 minutes* for large `max_tokens` on **non-streaming** requests. `maxRetries` retries 408/409/429/5xx
  **and timeouts**, so worst-case wall clock is `timeout × (maxRetries + 1)`.
- `wrangler.jsonc` has **no `limits` block**, so the deployed Worker inherits plan defaults.

---

## Item-by-item verdicts

### 1. D1 — candidate filter with a ~60 pool floor

**DISAGREE.** Filter unconditionally; drop the floor.

Two problems with the floor. First, a floor *does* reintroduce removed titles into the candidate pool —
and it does so precisely in the state where the prompt-side guarantee is also weakest, because that same
state (a big accumulated exclusion set) is exactly when `clampTitleList`'s 50-entry cap is truncating the
exclusion list. Floor-plus-prompt is two defences that fail together, not defence in depth. Second, the
floor is near-unreachable by legitimate play and therefore mostly dead code: `selectCandidates` pulls
`CANDIDATE_POOL_SIZE = 250` (`matching.ts:22,87`) and caps at `CANDIDATE_CAP = 200`; the round cap is 10
and each round returns 5–7 picks, so legitimate exclusions max out around 70. 250 − 70 is nowhere near 60.

Is prompt-only acceptable as a backstop? No, not on its own. `parseMatchingResponse` validates against
`validTmdbIds`, which is the whole candidate set (`matching.ts:482`), so nothing but the prompt line stands
between a rejected film and the results page — and `design-doc.md:308` states "never return" as a contract.
Keep the prompt instruction, add the structural filter, and when the filtered pool genuinely cannot yield
`MIN_SURVIVING_RECOMMENDATIONS = 3`, let it fail honestly as `thin_results` (the UI already frames that as
"That was a tough brief"). A silently-returned rejected film is a worse outcome than an honest error.

**Blocking prerequisite (new finding — see item 11.1).** `removedTmdbIds` is *unvalidated client input*:
`validateBody` (`match/route.ts:43-50`) only checks `Array.isArray`, `length <= 50`, and `Number.isInteger`.
Those integers are persisted verbatim by `insertRecommendation` and unioned by `getAccumulatedRemovedIds`.
Today that is cosmetic (they only add noise to a prompt line). The moment you make removed ids drive
`selectCandidates`, a client can post the top 200 popular tmdb ids as "removed" over four rounds and control
the candidate pool. Constrain removed ids server-side to ids that actually appeared in a prior round's
`ai_response.recommendations` (or in the round's `candidate_snapshot`) **in the same change** as the filter.

### 2. D2 — chunk `resolveIds`

**AGREE.** Verified `src/app/api/titles/search/route.ts:53-65` does `.bind(...ids)` with
`MAX_RESOLVED_IDS = 100`, and `fetchProfileDraft` (`src/lib/session-flow.ts:72-77`) requests exactly
`[...new Set([...comfort, ...watchlist])]` — up to exactly 100 — in normal use. That is the D1 ceiling with
zero headroom, and the fake D1 only throws at >100 (`src/test/fake-d1.ts`), so no test can distinguish "at
the limit" from "one over". Its two siblings (`getTitlesMap`, `selectCandidates`) already chunk. Six lines,
no behaviour change, removes a cliff. Do it.

### 3. D3 — ~45 s whole-request budget mapped to the existing `timeout` kind

**AGREE-WITH-CHANGE.** The budget is available, but option C alone bounds nothing — you need a per-call
`AbortSignal`/`timeout` as well (i.e. B **and** C).

*Is 45 s available?* Yes, and the report's framing of the constraint is wrong. HTTP-triggered Workers have
**no** wall-clock duration limit; the constraint is **CPU** time, and time spent awaiting the Anthropic call
costs zero CPU. On Paid (30 s CPU default) a 45 s wall-clock hold is entirely fine, and `wrangler.jsonc`
declares no `limits` override, so you get the default. On Free the binding limit is **10 ms CPU per HTTP
request**, which this route (build a 200-candidate prompt, `JSON.parse` a 16 K-token response,
`JSON.stringify` it into D1) will blow regardless of any deadline — see item 9.

*Why C alone fails.* `callClaude` constructs `new Anthropic({ apiKey, maxRetries: 1 })` (`matching.ts:390`)
and never passes a `timeout`. The TS SDK's default is 10 minutes and it **scales that default up to 60
minutes for large `max_tokens` on non-streaming requests** — and `max_tokens: 16000`, non-streaming
(`matching.ts:413-423`). Timeouts are themselves retried, so worst case per `runMatching` attempt is
`timeout × 2`, and `MAX_ATTEMPTS = 2` doubles it again. A budget that only refuses to *start* attempt 2 does
not bound a single attempt that is already hanging for tens of minutes. Ship both: an explicit per-call
timeout (`clientFactory` → `new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 })`, or a per-request
`{ timeout }` option) *and* the ~45 s whole-request budget checked before attempt 2. Mapping both to the
existing `timeout` kind is correct — the taxonomy is locked, the UI copy ("Our movie brain is taking a nap")
is honest for a deadline, and `MATCHING_ERROR_HTTP.timeout` is already 503.

### 4. D4 — prune `rate_limit_log` inside `logJoinAttempt`

**AGREE-WITH-CHANGE.** Prune there, but **do not put the DELETE in the same `db.batch()` as the INSERT**,
and scope the DELETE to `scope = 'group_join'`.

Does deleting inside the hot path change rate-limit correctness under the accepted TOCTOU race? No.
`checkJoinRateLimit` (`groups.ts:181-191`) counts only rows with `at >= strftime(...,'now','-10 minutes')`,
so deleting rows strictly older than that window is invisible to the count. The accepted check-then-log race
is unaffected — it is about ordering between two concurrent requests, not about row retention.

The change I want is about the failure mode. D1 `batch()` is a real transaction: if the prune statement
fails, **the whole batch rolls back and the join attempt is never logged**, while the caller proceeds to
`joinGroup` anyway (`join/route.ts:53-55` — `logJoinAttempt` is awaited but its failure would propagate to
the 500 handler, and under partial pressure you get an unlogged-but-attempted join). Coupling a
security-relevant write to a housekeeping write is the wrong trade. Issue the prune as a separate statement
after the INSERT, wrapped in its own `try {} catch {}`, or fire it probabilistically (e.g. ~5% of calls) to
avoid a second round trip on every attempt. Also scope it: the schema comment already anticipates a
`'match'` scope with a possibly different window, and a global `DELETE FROM rate_limit_log WHERE at < …`
keyed to the *join* window would silently break it.

### 5. D5 — synopsis clamp + newline strip + guardrail extension + `PROMPT_VERSION` bump

**AGREE-WITH-CHANGE — and the change is large.** The proposed fix is correct as far as it goes, but it
covers the *least* attacker-controlled input on the surface and is not sufficient for a launch gate that
claims an adversarial prompt-injection pass.

Verified: `firstSentence` (`matching.ts:193-196`) does have both facets — `match[0]` is unclamped, and the
`clampText(text, 160)` fallback can carry newlines into the pipe-delimited `CANDIDATES` block. Fine. But a
TMDB synopsis requires editing a third-party community database. Meanwhile the following reach the same
prompt with **no** newline stripping and **no** escaping, straight from the user:

- **Custom vibe/dealbreaker tags.** `TagPicker.addCustomTag` (`tag-picker.tsx:37-47`) accepts arbitrary
  free text up to `MAX_TAG_LENGTH`; server-side `validateTagList` (`user/profile/route.ts:40-47`) checks
  only `typeof === "string"` and `length <= 30`. Thirty tags × 30 chars = 900 characters of attacker-authored
  text, newlines included, joined with `", "` into `- Vibes:` / `- Dealbreakers:` lines.
- **`streamingServices`** — same validator, same properties.
- **Member `name`** — clamped to 50 chars (`matching.ts:275`) but not newline-stripped, and it sits at the
  start of a `Member: ${name}` line.
- **`moodText` and `steeringFeedback`** — interpolated *inside double quotes*
  (`matching.ts:250`, `:286`) with no quote escaping, so a `"` terminates the quoted span.
- **Comfort/watchlist title strings** — from `titles.title`, which the profile PUT populates from TMDB for
  any tmdb id the user chooses.

The concrete, app-specific payoff makes this worth taking seriously: `computeWeightNote`
(`matching.ts:204-218`) injects the **private** rough-day weighting into the *same user message* as those
attacker-controlled tags, with the instruction "Never surface this weighting in any output". VC5 records
that the flag is never serialized to a response — true — but an injected instruction that gets the model to
name whose preferences were prioritized defeats the feature's entire privacy premise, from inside the group,
against a partner. That is the test case the launch gate must actually run.

What I would ship: one shared `sanitizePromptText()` applied to **every** user-derived string that reaches
the prompt (strip `\r`/`\n` and other C0 control chars, then clamp) — names, tags, streaming services,
titles, mood text, steering feedback, and synopses — plus structural delimiting so a stray newline can't
forge a field (fenced blocks with a per-request nonce, or render the member/candidate blocks as JSON, which
is newline-safe by construction), plus the guardrail sentence broadened to cover *all* content below it,
plus the `PROMPT_VERSION` bump and an `matching.eval.test.ts` re-run. Synopsis-only + a one-sentence
guardrail widening is a ~15-line fix that would let the team mark the gate green on a surface it never
tested.

### 6. D6 — cron error split + `waitUntil` `.catch`

**AGREE-WITH-CHANGE.** Do the error split; replace `waitUntil` rather than bolting a `.catch` onto it.

Verified `worker.ts:16` is `ctx.waitUntil(runWeeklyRefresh(env))` inside `scheduled()`. Adding `.catch` gets
you a log line, but it also keeps the invocation reporting **success** to Cloudflare's cron metrics no matter
what happened. In a `scheduled()` handler the idiomatic and more useful shape is to `await` the promise
inside a `try { } catch { log cron_failed; throw }` — a thrown error marks the Cron Trigger invocation failed
in the dashboard, which is a free monitoring surface you otherwise don't have. (Wall-clock headroom is not a
concern: cron invocations get 15 minutes.)

On the counter split, also fix the counting bug while you're in there: `refreshed += batch.length`
(`cron-handler.ts:49`) counts statements queued, not rows matched, and the UPDATE is keyed
`WHERE tmdb_id = ? AND content_type = ?` — a drifted `content_type` matches zero rows and still counts as
refreshed. `db.batch()` returns per-statement `meta.changes`; sum those instead. Ten lines, and it is a
precondition for verifying any B6 fix in production.

### 7. D7 — chunked `IN()` for the profile PUT

**AGREE.** Verified `user/profile/route.ts:118-126` runs `SELECT 1 FROM titles WHERE tmdb_id = ?` in a
sequential `for` loop over up to 100 deduped ids, on the ritual's Continue button
(`ritual/page.tsx:132` blocks the step on the PUT). The replacement statement has no other bound parameters
(`content_type = 'movie'` is a literal), so `D1_IN_CHUNK_SIZE = 90` is comfortable. One implementation note:
preserve `unknownIds` ordering by iterating `referenced` and testing against a `Set` built from the query
results, not by iterating the results — `MAX_UNKNOWN_IDS_PER_PUT` and the `failedIds` response body are both
order-visible. Land it with D2 so the chunking discipline is uniform.

---

## 8. Fix approaches for the five significant bugs

### 8a. B1 — refresh rotation race (`auth.ts:115-125`)

**AGREE-WITH-CHANGE.** Grace-period reuse is correct; the other two alternatives do not work at all, and
the grace implementation needs a specific shape to avoid opening replay.

**Widening the session cookie is a non-fix.** The report's own evidence explains why: `setAuthCookies` pins
`mn-session` to `Max-Age=900` (`auth.ts:188`) to match the 15-minute JWT. Widening the cookie's `Max-Age`
changes nothing, because the failing check is `verifyJWT` (`auth.ts:96`) on an **expired** JWT — the browser
would simply send a dead token and fall through to the same rotation path every 15 minutes. Rule it out.

**Retry is structurally impossible, not merely slow.** The loser cannot recover by re-reading `sessions`:
the winner's new refresh token exists only as a SHA-256 hash in the row and as plaintext in the *winner's*
`Set-Cookie`. The loser has no way to obtain the plaintext, so it cannot mint a valid cookie for the client
no matter how long it waits. Any retry design collapses into "the loser also rotates", which is the token-
proliferation failure below.

**The wrong grace shape** — keep the old row alive for N seconds and let losers rotate from it — is worse
than the bug. `/ritual` fires three concurrent requests (`ritual/page.tsx:75-79`); all three would mint
distinct 90-day refresh tokens, the browser keeps whichever `Set-Cookie` lands last, and the other two remain
valid and unreferenced for 90 days. That is a real replay-surface expansion.

**What I'd ship.** Read-then-atomically-claim, where the loser authenticates but issues no cookies:

1. Add a nullable `rotated_at TEXT` column to `sessions` (one migration).
2. Read first, mutate second — `SELECT s.user_id, s.expires_at, s.rotated_at, u.email FROM sessions s
   JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`. This also fixes B4's ordering (below): every
   read that can fail now happens before any write.
3. Claim atomically in one `db.batch([...])`:
   `INSERT INTO sessions (...) SELECT ?, user_id, ?, ? FROM sessions WHERE token_hash = ? AND rotated_at IS NULL AND expires_at > ?`
   followed by `UPDATE sessions SET rotated_at = ? WHERE token_hash = ? AND rotated_at IS NULL`.
   The UPDATE's `meta.changes` is the single-winner arbiter, and `batch()` makes the pair atomic.
4. Winner: `setAuthCookies` as today. Loser (`changes === 0`): if the row's `rotated_at` is within a short
   grace window (30 s is plenty for a `Promise.all` fan-out and two-tab navigation) and `expires_at > now`,
   return `{ user, headers }` **with no `Set-Cookie` at all** — the winner already set them. Outside the
   window, current behaviour (401, cookies untouched).

This keeps `user: null` meaning exactly "unauthenticated" for all 13 call sites, so no route changes. It
creates zero extra refresh tokens. The reuse window is the standard refresh-token-rotation accommodation
for network races (RFC 6819 / OAuth BCP), and 30 s is a much smaller widening than the app's current
posture, which has no reuse detection or family revocation at all. Prune `rotated_at IS NOT NULL AND
rotated_at < now-grace` rows opportunistically. `auth.test.ts:375` must be rewritten, not extended — it
currently asserts the loser's 401 as correct behaviour.

### 8b. B2 — ex-member matching authority

**AGREE.** Gate `POST /api/movie-sessions/[id]/match` on a live `group_members` row; leave the read-only GET
on `session_members`.

Verified the asymmetry is real and unintentional: `getGroupDetailForMember` (`groups.ts:132-150`) checks
`group_members` and 404s an ex-member, while `getSessionForMember` (`movie-sessions.ts:164-206`) joins
`session_members` and both callers use it. `getSessionMembersWithProfiles` (`:225-260`) then `LEFT JOIN
profiles` — **current** profile rows — so a regenerate after a split ships the other person's present-day
comfort films, watchlist, vibes and dealbreakers to the model.

Read access is the right privacy line to hold, and I'd hold it deliberately, not by default. The join page's
promise — "Joining … shares your taste profile with its other members" (`groups/join/[code]/page.tsx:94`) —
is about the act of sharing at a point in time. A stored round is a record of a shared evening that the
ex-member was legitimately part of; revoking their view of it destroys their history to protect data they
already saw. What is *not* covered by that promise is deriving a **new** analysis from **post-split** data,
on the account owner's Anthropic spend, up to the 10-round budget. Write/spend authority must track live
membership; read access to a completed round should not.

Ship: after `getSessionForMember` succeeds in `match/route.ts`, additionally require
`SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?` for `(session.groupId, user.userId)`;
403 otherwise. Do **not** push it into `getSessionForMember` — that would close the history read too.
Solo sessions are unaffected (the creator is always a member of their own `__solo__` group).

### 8c. B4 — rotation destroys the session on a transient D1 failure

**AGREE-WITH-CHANGE.** D1 `batch()` **is** transactional — confirmed against the docs, quoted at the top —
so the report's "issue the replacement row in the same `db.batch` as the delete" instinct is sound. But it
cannot be implemented as literally written, and the report doesn't say so.

The obstacle is a data dependency. The current code needs `claimed.user_id` from the `DELETE … RETURNING`
before it can build the INSERT, and it needs `userRow.email` from an intervening `SELECT` before it can sign
the JWT. `batch()` executes prepared statements; a later statement cannot consume an earlier one's
`RETURNING` output. So "just batch them" doesn't compile.

There are two working shapes. The one I recommend is **8a's step 2+3**: move the user/email read *before*
any mutation, then do the claim as an `INSERT … SELECT` + `UPDATE … RETURNING` pair inside one `batch()`.
That fixes B1 and B4 with the same code and eliminates the destroy-then-recreate window entirely rather than
compensating for it. Note that ordering is load-bearing: the failure mode B4 describes is *any throw between
the claim and the insert*, and the `SELECT email FROM users` sitting in that window (`auth.ts:135-138`) is
the largest contributor. Moving it earlier is most of the fix.

If B1 is deferred and only B4 is being fixed, the minimum is a single atomic statement:
`UPDATE sessions SET token_hash = ?, expires_at = ?, created_at = ? WHERE token_hash = ? AND expires_at > ? RETURNING user_id`
— `token_hash` is the PK, so exactly one concurrent caller can match; there is no gap where the session does
not exist. Still move the email read ahead of it, or a throw after the UPDATE leaves the client holding a
token the DB no longer knows while the new one never reached a cookie — the same wedge, relocated.
A try/catch that clears cookies is an acceptable belt-and-braces addition but should not be the primary fix:
it converts "permanently wedged" into "silently signed out", which is better but still user-visible data loss
for a transient blip.

### 8d. B5 — real name persisted in `ai_response` after account deletion

**AGREE-WITH-CHANGE.** A structural scrub is **not** enough, blanking `conversational` is **not** acceptable,
and the honest minimum is a scrub-at-delete that covers both — sequenced before the existing batch.

Verified the exposure. `deleteAccount` (`account.ts:8-16`) never touches `recommendations`. `ai_response`
stores the full `MatchingResponse` JSON (`movie-sessions.ts:340`), whose `tasteMap.members[].name` is
`required` in `MATCHING_RESPONSE_SCHEMA` (`types/matching.ts`) and fed from the member list
(`matching.ts:276`), and whose `conversational` is produced under an explicit "Reference members by name"
instruction (`matching.ts:259`). `GET /api/movie-sessions/[id]:38` re-serves that blob verbatim and
`taste-map.tsx` renders `{member.name}` directly. The promise the user reads at the moment of an irreversible
action is unambiguous — `privacy/page.tsx:90`: "your identity is replaced with '[deleted user]'";
`profile/page.tsx:235`: "with your name replaced by '[deleted user]'". Grep confirms neither string exists
anywhere in `src/` except those two pages.

- **Structural-only scrub** (`tasteMap.members[].name`) leaves the name in prose the same page renders two
  tabs over. It makes the copy *more* misleading, not less, because a user who checks the taste map sees the
  placeholder and concludes the promise was kept.
- **A render-time placeholder** has the same gap and additionally requires the session GET to publish a list
  of deleted userIds — new API surface, same hole.
- **Blanking or regenerating `conversational`** is not acceptable. Regenerating spends money and produces a
  different evening's write-up; blanking contradicts the *other* half of the same promise ("so the group's
  history survives without you in it" / "their history doesn't develop holes"). Destroying the survivor's
  record to satisfy the deleter's is not a trade the copy offers.
- **Softening the copy** is a legitimate fallback but a poor one here: the privacy page's sentence is the
  concrete, checkable claim, and "we remove your name from the structured summary but the written recap may
  still mention you" is a promise nobody would read as privacy-preserving.

**Honest minimum:** at delete time, read the user's `name` from `users` **first**, collect the affected rows
(`SELECT r.id, r.ai_response FROM recommendations r JOIN session_members sm ON sm.session_id = r.session_id
WHERE sm.user_id = ?`), then for each row rewrite the JSON: set `tasteMap.members[].name` to `[deleted user]`
for the matching `userId`, replace that entry's `userId` with the same sentinel the `session_members` update
uses so the two agree, and do a word-boundary, case-insensitive literal replacement of the stored name across
the serialized document (this catches `conversational`, `overlap.summary`, and per-pick explanations in one
pass, and handles possessives correctly). Guard on `name.length >= 2` so a one-character display name can't
shred the prose. **Then** run the existing `db.batch`. The ordering is not optional — the batch anonymizes
`session_members.user_id`, which is the join key you need to find the rows, and it deletes the `users` row,
which is where the name lives. Doing the scrub first is also the safe failure order: a partial scrub leaves
the account undeleted and the operation retryable.

At Phase 1 volume (≤ 10 rounds per session, a handful of sessions per user) this is a bounded amount of work
inside one request. If it ever isn't, chunk it — but do not defer it to a background job, because the user is
told the replacement has happened.

### 8e. B3 — exclusion truncation

**AGREE-WITH-CHANGE.** Fix the slice direction **and** make the ordering explicit **and** raise the cap
**and** add D1's structural filter. Newest-50 is the right *direction* but the wrong *cap*.

Two implementation details the report's fix approach doesn't state precisely:

1. `getAccumulatedRemovedIds` (`movie-sessions.ts:125-135`) has no `ORDER BY` and doesn't even select
   `round_number`. Adding `ORDER BY round_number DESC` is necessary but not sufficient — the route builds
   the union as `[...accumulated, ...removedTmdbIds]` (`match/route.ts:117-119`), appending **this round's**
   removals last. If you make the accumulated list newest-first and leave that concatenation alone, the ids
   removed on *this very request* still land at the tail and are still the first thing truncated. The route
   side must flip to `[...removedTmdbIds, ...accumulated]`.
2. `clampTitleList` is shared by four call sites (`matching.ts:233, 234, 277, 278`). Flipping the slice
   *globally* is a no-op for the member comfort/watchlist uses (already server-capped at 50 by
   `user/profile/route.ts:11`), but fixing at the producer is still cleaner than making a shared helper
   direction-aware.

**On the cap: prompt-size math says raise it.** A formatted entry is `"Title (tmdbId 12345)"` — roughly 25–35
characters, call it ~10 tokens. Fifty entries ≈ **500 tokens**. The `CANDIDATES` block, by contrast, is up to
200 lines of `id | title (year) | genres | first sentence` at roughly 35–45 tokens each — **7,000–9,000
tokens**. The exclusion list is under 6% of the block it sits next to. Raising the cap to 100 costs ~500
tokens and puts it comfortably above the reachable legitimate ceiling (10 rounds × 7 recommendations = 70).
I would not remove the cap entirely — `removedTmdbIds` is unvalidated client input (item 11.1), so an
unbounded list is an unbounded prompt — but 50 is arbitrarily tight for the one guarantee the product
advertises. Cap at 100, ordered newest-first, with the structural filter as the real enforcement.

---

## 9. Dropping `STALE_TITLES_LIMIT` 200 → 40 until the plan tier is confirmed

**AGREE-WITH-CHANGE.** 40 does fit under the external-subrequest limit — comfortably, and for a different
reason than the code comment states — but it does **not** make the cron work on Free. Confirm the plan; don't
treat 40 as a Free-tier fix.

**The subrequest arithmetic.** Per title, `fetchMovieDetail` (`tmdb.ts:245-256`) issues exactly **one**
`fetch` — `append_to_response=keywords,credits,watch/providers` folds three resources into one request — and
TMDB does not redirect, so it's one hop. Per run: 1 D1 `SELECT` + N × 1 TMDB fetch + `ceil(N/25)` `db.batch`
calls. The current code comment (`cron-handler.ts:6-9`) assumes one pooled 50-subrequest budget; that is now
wrong. Since 2026-02-11 the Free plan is **50 external + 1,000 internal**, and D1 is internal. So:

| | external (limit 50 on Free) | internal (limit 1,000 on Free) |
|---|---|---|
| N = 40 | 40 ✅ (10 spare) | 1 SELECT + 2 batches = 3 ✅ |
| N = 200 | 200 ❌ (fails at title 51) | 1 + 8 = 9 ✅ |

So 40 fits with 25% headroom, and the D1 calls never compete. Good.

**But the real Free-tier blocker is CPU, not subrequests.** Free is **10 ms CPU per Cron Trigger
invocation**. Each title costs a `response.json()` parse of a TMDB detail document carrying full credits,
keywords, and watch/providers (tens of KB), plus `detailToEnrichment` sorting and mapping, plus three
`JSON.stringify` calls. Forty of those will not fit in 10 ms. The same limit applies to the HTTP side: 10 ms
per request against a route that builds a 200-candidate prompt string, parses a 16 K-token model response,
and `JSON.stringify`s it into D1 — and OpenNext SSR on Workers routinely exceeds 10 ms on its own. This
application is not viable on the Free plan at all.

**What I'd ship:** confirm the plan (a one-line answer someone already knows) rather than shipping a
tier-hedging constant. If a hedge is genuinely wanted, make it explicit and self-documenting — read the limit
from an env var with a 200 default — and **fix the stale comment either way**, because a future agent reading
"Free plan caps at 50 subrequests/invocation" will draw the wrong conclusion about D1 calls. Note also that
lowering the limit interacts with B6: at 40/week against a ~1,000-title seed (`scripts/seed.ts:19`,
`DEFAULT_PAGES = 50`), a full sweep takes 25 weeks *even after* the `ORDER BY last_refreshed_at ASC` fix.
Ranks 201+ going stale is B6; ranks 41+ going stale for half a year is a different, worse product outcome.

---

## 10. B15 — deterministic invite code + `INSERT OR IGNORE` for the `__solo__` bootstrap

**AGREE-WITH-CHANGE.** The uniqueness/joinability model holds — no one can join your solo group by learning
the deterministic code — but the batch as sketched will fail on the losing racer, which is the exact case
the fix exists to handle.

**Joinability: safe, with two independent guards.** I read `joinGroup` (`groups.ts:109-123`) and the join
route. A deterministic `solo-${userId}` code cannot be used to join, because:

1. `POST /api/groups/join` rejects it **before any DB access** — `CODE_FORMAT = /^[2-9A-Za-z]{8}$/`
   (`join/route.ts:9,34`). `userId` is `crypto.randomUUID()` (`auth/google/callback/route.ts:124`), so the
   code is 41 characters with hyphens: wrong length, and hyphens aren't in the class.
2. Even bypassing the route, `joinGroup`'s query is `WHERE invite_code = ? AND name != ?` with
   `SOLO_GROUP_NAME` bound — a `__solo__` group is excluded by name regardless of its code.

Nothing surfaces the solo invite code either: `getGroupsForUser` (`groups.ts:153-170`) and
`getGroupDetailForMember` (`:132-150`) both filter `g.name != '__solo__'`. So the code is neither guessable-
into-a-join nor readable. Determinism does mean the code is derivable from a `userId`, and `userId` *is*
exposed to co-members inside `ai_response.tasteMap.members[].userId` — but since the value is unusable
through both guards, that's not a hole. (If it bothers you, `solo-${sha256(userId)}` costs nothing and
removes the derivation entirely.)

**The implementation change.** Don't put both inserts in one batch. D1 enforces foreign keys by default
(`PRAGMA defer_foreign_keys` exists to suspend them), and `group_members.group_id REFERENCES groups(id)`.
In the losing racer: the `INSERT OR IGNORE INTO groups` is silently ignored (the winner already holds the
unique `invite_code`), but the batch's second statement still tries to insert a `group_members` row pointing
at the loser's *never-created* `groupId` — FK violation, whole batch rolls back, exception propagates out of
`createSoloGroup` → `createMovieSession` → a 500 on the user's "Find our match" tap. That is the double-tap
scenario the fix is for. Sequence it instead:

1. `INSERT OR IGNORE INTO groups (id, name, invite_code, created_at) VALUES (?, '__solo__', ?, ?)` with the
   deterministic code;
2. `SELECT id FROM groups WHERE invite_code = ?` — this is now the authoritative id, winner or loser;
3. `INSERT OR IGNORE INTO group_members (...)` using **that** id (the existing `UNIQUE(group_id, user_id)`
   makes step 3 idempotent).

No migration needed — `UNIQUE(invite_code)` is already the backstop. Keep the existing fast-path `SELECT` at
the top so the steady state stays one query. The client-side double-submit guard on `/quick`'s CTA
(`quick/page.tsx:266`) is worth adding but is not the fix.

---

## 11. Regressions the proposed fixes would introduce, and fix ordering

### 11.1 `removedTmdbIds` is unvalidated client input — D1/B3 weaponizes it (**new; blocks D1**)

Covered in item 1. Restating as a standalone finding because neither the consolidated report nor any hunter
names it: `validateBody` (`match/route.ts:43-50`) accepts any 50 integers, `insertRecommendation` persists
them, `getAccumulatedRemovedIds` unions them. Today: prompt noise. After D1's structural filter: a
client-controlled subtractive filter over the candidate pool, reachable at 50 ids/round × 10 rounds. Fix
before or with D1 by intersecting submitted ids against the ids actually recommended in prior rounds
(available in `recommendations.ai_response`) or present in `candidate_snapshot`.

### 11.2 B14's "delete groups that lost their last member" can destroy an ex-member's history

`groups` → `movie_sessions` → `recommendations` / `session_members` all CASCADE
(`migrations/0001_initial_schema.sql:52,64,72`). "Empty group" is defined by `group_members`, and
`group_members.user_id REFERENCES users(id) ON DELETE CASCADE` — so a member who **left** via `leaveGroup`
has no `group_members` row but *does* still have `session_members` rows and, per the B2 decision above, a
legitimate read of that history. Sequence: A and B share a group → A leaves → B deletes their account → the
group is now "empty" → CASCADE destroys every session and round A could still read. That is exactly the
history the design doc and the B2 decision both say to preserve, deleted as a side effect of someone else's
action. If B14(a) ships, the emptiness test must be `no live group_members AND no surviving session_members
pointing at a live user`, or — simpler and safer — delete the `groups` row only when no `movie_sessions`
reference it, and correct the copy for the rest.

### 11.3 B5's scrub must run *before* `deleteAccount`'s batch

Detailed in 8d. The batch anonymizes `session_members.user_id` (the join key the scrub needs) and deletes the
`users` row (where the name lives). Wrong order silently scrubs nothing. This is a hard ordering constraint
between two fixes that touch the same rows.

### 11.4 B1, B4, and B15 all rewrite the same code paths — sequence them

B1 and B4 are the same twelve lines of `auth.ts` and the same `sessions` table; landing them independently
means writing the rotation twice and reviewing it twice, and a B4-only fix that keeps DELETE-then-INSERT will
be thrown away by B1's grace-window column. Land them as one change (8a's shape covers both). Similarly,
B15's `createSoloGroup` rewrite and B14's `__solo__` guard in `leaveGroup` touch adjacent invariants — do
B15 first so the "exactly one solo group per user" property is true before anything else starts reasoning
about solo-group identity.

### 11.5 B9 and B5 both hinge on the deleted-member sentinel — do B9 after B5

B9's fix makes `member_count` join `users`, which makes `solo` agree with the prompt membership. B5's scrub
rewrites `ai_response`. Both key off `deleteAccount`'s sentinel. Doing B5 first means B9's catch-test can
assert the full post-deletion state (`solo: true`, no name in the blob, count agrees with
`getSessionMembersWithProfiles(...).length`) in one fixture instead of two.

### 11.6 B13's read-path validation must not silently swallow a corrupt row

Degrading a corrupt `ai_response` to `response: null` gives the user a working "Find our match →" button
(`results/[sessionId]/page.tsx:238`) — good UX, but it turns a data-corruption event into a silent one, and
`insertRecommendation` failures are already invisible (B12). Log a structured line when the read-path guard
rejects a stored row. Cheap, and it's the only signal you'd ever get.

### 11.7 D6's `waitUntil` → `await` interacts with B6's fix

If B6 changes the ordering to `ORDER BY last_refreshed_at ASC` and adds a failure-attempt timestamp, the run
does more D1 writes per invocation. Still trivially within the 15-minute cron wall and the 1,000 internal
subrequest budget, but land D6's observability **first** — the report is right that you cannot verify a B6
fix without being able to tell a TMDB outage from a D1 write failure in the log line.

---

## Summary of where I diverge from the consolidated report

| # | Item | Verdict | Divergence |
|---|---|---|---|
| 1 | D1 candidate filter | DISAGREE | No floor; filter unconditionally, fail as `thin_results`. Blocked on validating `removedTmdbIds`. |
| 2 | D2 chunk `resolveIds` | AGREE | — |
| 3 | D3 45 s budget | AGREE-WITH-CHANGE | Wall clock is unlimited (CPU is the limit); option C alone doesn't bound a 10–60 min SDK timeout — need per-call timeout too. |
| 4 | D4 prune rate limit log | AGREE-WITH-CHANGE | Not in the same `batch()` as the counted INSERT; scope the DELETE to `group_join`. |
| 5 | D5 injection surface | AGREE-WITH-CHANGE | Synopsis-only is far too narrow — custom tags, names, titles, mood/steering are the real surface, and the rough-day weighting note is the payoff. |
| 6 | D6 cron observability | AGREE-WITH-CHANGE | `await` + rethrow, not `waitUntil().catch()`; also fix `refreshed` to sum `meta.changes`. |
| 7 | D7 chunked profile PUT | AGREE | Preserve `unknownIds` ordering. |
| 8a | B1 rotation race | AGREE-WITH-CHANGE | Cookie widening is a no-op; retry is impossible; grace must be no-cookie-for-losers, not loser-also-rotates. |
| 8b | B2 ex-member match gate | AGREE | Read stays `session_members`; write/spend tracks live membership. |
| 8c | B4 atomic rotation | AGREE-WITH-CHANGE | `batch()` is transactional (confirmed) but can't be used as written — data dependency; read email *before* mutating. |
| 8d | B5 deleted name | AGREE-WITH-CHANGE | Structural scrub insufficient; blanking unacceptable; scrub structured + free text at delete, before the batch. |
| 8e | B3 truncation | AGREE-WITH-CHANGE | Also flip the route-side union order; raise the cap to 100 (50 entries ≈ 500 tokens vs a 7–9 K-token candidate block). |
| 9 | `STALE_TITLES_LIMIT` 40 | AGREE-WITH-CHANGE | 40 fits (50 *external*; D1 is internal), but Free's 10 ms CPU kills the app anyway — confirm the plan, fix the stale comment. |
| 10 | B15 solo bootstrap | AGREE-WITH-CHANGE | Joinability model holds (two guards). Don't batch the two inserts — FK violation on the loser. |
| 11 | Regressions / ordering | — | New finding 11.1; B14 can destroy an ex-member's history (11.2); hard ordering constraints in 11.3–11.5. |
