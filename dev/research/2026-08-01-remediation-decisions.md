# Phase 1 Remediation — Decision Record

**Date:** 2026-08-01
**Status:** FINAL. These decisions are settled. The implementation plan
(`dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md`) carries the *what*; this file carries
the *why*, so a later session does not re-open a closed question.

**How these were reached.** The consolidated bug hunt
(`dev/bug-hunts/2026-08-01-phase1-consolidated.md`) proposed a fix approach per finding and left
seven design questions open. Two **independent** Opus reviews then read the report, the design doc,
the pitfalls docs and the source, each verifying every line reference themselves:

- **ARCH** — `dev/research/2026-08-01-remediation-sanity-architecture.md`, product/architecture
  lens: YAGNI, simplicity, blast radius, fit with the design brief.
- **SEC** — `dev/research/2026-08-01-remediation-sanity-security.md`, correctness/security/privacy/
  data-integrity lens.

Where they agreed, the decision is theirs. Where they diverged, the resolution and its reasoning
are recorded below. Sam was away; the orchestrator reconciled.

---

## 0. Platform facts verified against Cloudflare and SDK sources

Several decisions turn on these. They were checked against the live docs and the installed
package on 2026-08-01 — **not** recalled from training data. Both reviews independently confirmed
the first three.

| Fact | Consequence |
|---|---|
| The **1,000-subrequest** limit was removed on **2026-02-11**. Workers **Paid** now defaults to **10,000** subrequests per invocation, configurable to 10M via `limits.subrequests`. | Overturned the `STALE_TITLES_LIMIT` question outright — see §1. |
| Workers **Free** is **50 *external* subrequests + 1,000 to Cloudflare services**. D1 calls are *internal*. | 200 TMDB fetches = 200 external; the 9 D1 calls never compete. The code comment at `cron-handler.ts:6-9` assumed one pooled budget and was wrong. |
| **HTTP-triggered Workers have no wall-clock duration limit** while the client stays connected. **CPU** is the metered limit: Free 10 ms, Paid 30 s default (5 min max via `limits.cpu_ms`). Awaiting a subrequest costs zero CPU. | A 45 s hold on the match route is fine on Paid. It also means the app **cannot** run on Free at all — an OpenNext SSR render plus a 200-candidate prompt build plus a 16 K-token `JSON.parse` will not fit in 10 ms. |
| Cron Triggers get **15 minutes** wall-clock. | `await`ing `runWeeklyRefresh` in `scheduled()` is safe. |
| **`db.batch()` is transactional.** Cloudflare's D1 docs: *"Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."* Statements execute sequentially, non-concurrently. | Load-bearing for B1/B4 (the claim pair is atomic) and for D4 (a batched prune could roll back a rate-limit record). |
| **D1 enforces foreign keys by default** (`PRAGMA defer_foreign_keys` exists to suspend them). | Load-bearing for B15's statement sequencing. |
| **Anthropic TS SDK** (`@anthropic-ai/sdk@0.112`, read from `node_modules`): default `timeout` is **10 minutes** (`client.d.ts:195`), the SDK **scales that default up** for large `max_tokens` on non-streaming requests, and **timeouts are themselves retried** (`client.d.ts:87-88`). `maxRetries` and `timeout` are public instance properties (`client.d.ts:179-180`). `APIConnectionTimeoutError extends APIConnectionError` (`core/error.d.ts:29`). | Made D3 far more urgent than the report suggested (tens of minutes, not 20), and made the fix a one-liner with no error-taxonomy change. |
| `wrangler.jsonc` declares **no `limits` block**, so the deployed Worker inherits plan defaults; it *does* declare `observability.enabled: true` with `invocation_logs`. | A `waitUntil` rejection is not literally invisible — it records an `exception` outcome — but it is not *findable*, which is why D6 adds a named line **and** a rethrow. |

---

## 1. `STALE_TITLES_LIMIT` — KEEP 200

**Support:** ARCH `DISAGREE` (with the proposal to drop to 40); SEC `AGREE-WITH-CHANGE`.
**Decision:** keep 200; fix the stale comment; document "Workers Paid required" in
`docs/deploy.md`.

**This is the decision the verified facts overturned.** The proposal to drop the limit to 40 rested
on the code comment at `cron-handler.ts:6-9`, which states *"The Free plan caps at 50
subrequests/invocation"* against a Paid limit of 1,000. **Both halves of that premise are now
wrong**: the Paid default is 10,000, and the Free 50 applies to *external* subrequests only, with a
separate 1,000-call budget for Cloudflare services that D1 draws on. Every argument for 40 was
built on the obsolete numbers.

The reviews then converged from different directions:

- **SEC** did the arithmetic and confirmed 40 *would* fit under the Free external limit with 25%
  headroom — and then established that it does not matter, because the binding Free constraint is
  **10 ms CPU per invocation**. Forty TMDB detail parses will not fit in 10 ms, and neither will
  the app's HTTP side. *"This application is not viable on the Free plan at all."* So 40 is not a
  Free-tier fix; it is a tier-hedging constant that hedges nothing.
- **ARCH** priced the downside. The seed is ~1,000 titles (`scripts/seed.ts:19`,
  `DEFAULT_PAGES = 50`). At 200/week an oldest-first sweep clears the catalog in ~5 weeks; at
  40/week it takes ~25. `asOfNote` (`ranked-list.tsx:34-42`) begins printing "as of &lt;seed
  date&gt;" after a fortnight, so at 40 most of the catalog would carry a staleness stamp
  essentially forever. *"You would be fixing B6 and then re-breaking its outcome in the same
  commit."*

The asymmetry decides it: guessing wrong toward 200 costs one noisy cron log on a plan the app
cannot run on anyway (and the per-title `catch` at `cron-handler.ts:78-80` already swallows
`Too many subrequests` gracefully — a Free run would refresh ~49 titles and log ~151 fetch errors,
which D6's counter split makes self-diagnosing in the very first log line). Guessing wrong toward
40 costs the catalog-freshness goal permanently.

**Rejected alternatives:** an env-var override for the limit (SEC floated it as a hedge — rejected
as a knob nobody will set correctly), and a second cron trigger (ARCH: "Phase 2 thinking").

---

## 2. D1 — filter removed ids out of the candidate pool, with **no** pool floor

**Support:** ARCH `AGREE-WITH-CHANGE` ("filter yes, drop the floor"); SEC `DISAGREE` with the
floor, agree with the filter. **Both reviewers independently rejected the floor**, which the
consolidated report had recommended.

Two distinct arguments, both fatal:

- **SEC — the floor fails at exactly the wrong moment.** A floor reintroduces removed titles into
  the pool precisely in the state where the prompt-side exclusion list is *also* being truncated
  by `clampTitleList`. Floor-plus-prompt is two defences that fail together, not defence in depth.
- **ARCH — it can never fire.** `CANDIDATE_POOL_SIZE = 250` narrowed to `CANDIDATE_CAP = 200`
  (`matching.ts:22-23`); the round cap is 10; each round returns 5-7 picks. Legitimate exclusions
  top out around 70. Driving the pool under 60 would need ~140 exclusions — twenty rounds against
  a ten-round budget. *"A branch that can never execute is a branch that can never be tested, and
  it introduces a worse intermediate state than either extreme: some removed titles are back in
  the pool, chosen by no rule."*

The failure mode the floor was guarding against already has a first-class handler:
`MIN_SURVIVING_RECOMMENDATIONS = 3` → `thin_results` → a UI framing that says "loosen a
dealbreaker" (`results/[sessionId]/page.tsx:57-60`). That is the honest answer to an
over-constrained brief. A silently-returned rejected film is a worse outcome than an honest error.

**ARCH's implementation note, adopted:** apply the filter to the whole pool *before* the
referenced/fill split at `matching.ts:136-141`, not just to `fill`. A title on a member's own
watchlist that the group rejected this session must still be excluded — "never return" has no
exception for "but it's on your list".

### 2a. The blocker SEC found that nobody else did (blocks D1)

**SEC, new finding 11.1.** `removedTmdbIds` is unvalidated client input beyond shape:
`validateBody` (`match/route.ts:43-50`) checks only `Array.isArray`, `length <= 50` and
`Number.isInteger`. Those integers are persisted verbatim and unioned by
`getAccumulatedRemovedIds`. Today that is cosmetic — they add noise to a prompt line. **After the
structural filter lands, they become a client-controlled subtractive filter over the candidate
pool**, at 50 ids/round x 10 rounds.

Neither the consolidated report nor any of the three hunters named this. It must land in the same
change as the filter.

*Correction recorded:* the reconciled decision text describes this as "validate it (shape, integer
ids, length cap)". Those three checks already exist. The load-bearing validation is **provenance** —
intersect submitted ids against the ids the session actually recommended in prior rounds (read from
`recommendations.ai_response`). Using `candidate_snapshot` instead would be useless, because it
holds the whole ~200-title pool, which is the thing being defended.

---

## 3. D2 — chunk `resolveIds`

**Support:** ARCH `AGREE`, SEC `AGREE`. No divergence. This was also the strongest cross-hunter
agreement in the entire bug hunt (3/3).

`MAX_RESOLVED_IDS = 100` against D1's hard 100-bound-parameter ceiling, with `.bind(...ids)` and
**zero headroom** (`titles/search/route.ts:13, 53-65`). It is the only `.bind(...spread)` in the
codebase that does not go through `chunk` / `D1_IN_CHUNK_SIZE`; its two siblings do
(`movie-sessions.ts:278`, `matching.ts:101`). `fetchProfileDraft` (`session-flow.ts:72-77`)
requests exactly up to 100 in normal use.

It is not a PLAT-1 violation *by the letter* — the collection is provably bounded, at exactly the
limit. But the fake D1 throws only at **>100** (`fake-d1.ts:29-33`), so no test can distinguish
"safely at the limit" from "one over": any future fixed parameter in that statement, or any bump to
the profile caps, breaks it in production only. `D1_IN_CHUNK_SIZE` is 90 precisely because 90
leaves headroom for fixed params.

No behavior change — `resolveIds` re-imposes caller order in its final `ids.map(...)`.

**Rejected:** lowering `MAX_RESOLVED_IDS` to 90 (silently truncates a full profile's resolution).

---

## 4. D3 — set the SDK's per-call `timeout`; do **not** build a wrapper budget

**Support:** ARCH `AGREE-WITH-CHANGE` (take option B via the SDK's own `timeout`, not the report's
option C); SEC `AGREE-WITH-CHANGE` (ship **both** B and C).
**Divergence:** whether a whole-request budget is needed on top of the per-call timeout.
**Resolution: per-call `timeout` only.**

Both reviews demolished the report's option C (a budget in `runMatching` that refuses to start
attempt 2) as a *standalone* fix, for the same reason: `runMatching` retries only on `malformed`
(`matching.ts:522`), so a hung call sits inside a **single** attempt that option C never gets to
veto. It bounds the multiple and leaves the worst single case unbounded.

Given that, C's marginal value on top of B is bounding the *malformed-retry* multiple — but a
`malformed` failure is by definition a *fast* one (a response arrived and parsed badly), so the
multiple it bounds is 2 x fast, not 2 x hung. That does not earn deadline threading through
`runMatching`. **B alone.**

The verified SDK facts made this both more urgent and cheaper than the report suggested. The
report's ~20-minute worst case understated it: the default timeout is 10 minutes and the SDK
*scales it up* for large `max_tokens` on non-streaming requests — and this call is
`max_tokens: 16000`, non-streaming. Timeouts are themselves retried.

The fix is one line, because `APIConnectionTimeoutError extends APIConnectionError`, which
`callClaude:426` already maps to `MatchingError("timeout")`. The locked `MATCHING_ERROR_HTTP`
contract and the UI's `ERROR_FRAMING` are untouched — which was the report's own stated reason for
preferring C.

**Value: 45 s.** The design doc budgets 5-15 s and `PhasedLoading`'s narrative is built for that,
so 45 s is 3x the top of the budget and fires only on genuine hangs. Honest arithmetic: the SDK
retries timeouts, so worst case is 90 s per app attempt and 180 s pathological — down from tens of
minutes.

**Rejected:** dropping `maxRetries` to 0 for a hard 45 s ceiling (ARCH offered it as a choice for
Sam). It removes the automatic retry on transient 5xx/429, which is a separate product decision,
not a bug fix.

---

## 5. D4 — prune `rate_limit_log` inside `logJoinAttempt`, **not** in a batch

**Support:** ARCH `AGREE-WITH-CHANGE` (scope the DELETE to the index; **"the item I would cut
first"**); SEC `AGREE-WITH-CHANGE` (do not batch it; scope it to `group_join`).
**Decision:** do it, as a separate non-batched statement in its own `try/catch`, scoped to
`(scope, key)`. **Explicitly marked droppable.**

- **SEC's change is the important one.** `db.batch()` is a real transaction. If a batched prune
  fails, the whole batch rolls back and **the join attempt is never logged**, while the caller
  proceeds to `joinGroup` anyway (`join/route.ts:53-55`). Coupling a security-relevant write to a
  housekeeping write is the wrong trade.
- **ARCH's change** is the index scoping: an unscoped `at < window` delete is a full table scan on
  every join. Irrelevant now, and precisely the thing that bites when the table is finally big
  enough to matter.
- Both noted the same non-issue: rate-limit correctness is unaffected, because
  `checkJoinRateLimit` counts only rows inside the 10-minute window, so deleting older rows is
  invisible to the count.
- ARCH also asked for a comment noting this destroys the only record of invite-code enumeration
  attempts — nothing reads it today, but the join route's own comment
  (`groups/join/route.ts:51-52`) presents the log as an anti-enumeration mechanism.

**Why droppable:** ARCH's read is that this is not a bug at any Phase 1 volume —
`logJoinAttempt` writes one row per *group join attempt*, a once-per-relationship act, so the table
will hold double-digit rows.

**Rejected:** pruning in the weekly cron (couples an unrelated concern to a job B6/D6 are already
fixing); firing the prune probabilistically (SEC floated ~5%; rejected because deterministic is
testable).

---

## 6. D5 — the injection surface is far wider than the synopsis

**Support:** ARCH `AGREE-WITH-CHANGE` (normalise before the regex); SEC `AGREE-WITH-CHANGE` **"and
the change is large."**
**Decision:** take SEC's expanded scope, with ARCH's implementation shape.

The report scoped D5 to `firstSentence` (`matching.ts:193-196`) — an unclamped `match[0]` and a
newline-carrying fall-through branch. Both facets are real. **But SEC established that a TMDB
synopsis is the *least* attacker-controlled input on the surface** — editing one requires editing a
third-party community database — while these reach the same prompt with no newline stripping and no
escaping, straight from the user:

- **Custom vibe/dealbreaker tags** — `TagPicker.addCustomTag` (`tag-picker.tsx:37-47`) accepts
  arbitrary free text; `validateTagList` (`user/profile/route.ts:40-47`) checks only
  `typeof === "string"` and `length <= 30`. Thirty tags x 30 chars = **900 characters of
  attacker-authored text per list**, newlines included, joined into `- Vibes:` / `- Dealbreakers:`
  lines.
- **`streamingServices`** — same validator, same properties.
- **Member `name`** — clamped to 50 (`matching.ts:275`) but not newline-stripped, and it opens a
  `Member: ${name}` line.
- **`moodText` and `steeringFeedback`** — interpolated *inside double quotes* (`matching.ts:250`,
  `:286`) with no quote handling, so a `"` terminates the span.
- **Comfort/watchlist title strings** — from `titles.title`, which the profile PUT populates from
  TMDB for any tmdb id the user chooses.

**The app-specific payoff is what makes this worth taking seriously.** `computeWeightNote`
(`matching.ts:204-218`) injects the **private** rough-day weighting into the *same user message* as
those attacker-controlled tags, carrying "Never surface this weighting in any output". VC5 in the
consolidated report verified the flag is never serialized to a response — true — but an injected
instruction that gets the model to name whose preferences were prioritized defeats the feature's
entire privacy premise, from inside the group, against a partner.

SEC's verdict on the narrow fix is the reason the scope moved: *"Synopsis-only plus a one-sentence
guardrail widening is a ~15-line fix that would let the team mark the gate green on a surface it
never tested."*

**ARCH's implementation shape, adopted:** normalise whitespace **before** the sentence match rather
than patching the fall-through branch's output. `.` not matching `\n` is the *cause* of both
facets; collapsing first kills the branch entirely instead of producing two behaviors.

**Adopted from SEC:** one shared `sanitizePromptText()` over every user-derived string; structural
delimiting so a stray character cannot forge a field; the guardrail broadened to cover candidate
data *and* user free text; `PROMPT_VERSION` bump; eval re-run.

**Rejected:** SEC's fenced-block-with-a-per-request-nonce and JSON-rendered candidate blocks. Once
newlines and the `|` field delimiter are stripped at the source, the line-oriented structure is
already unforgeable, and un-quoting the two free-text interpolations removes the only remaining
escape. A structural prompt rewrite is disproportionate churn for the same property.

**Out of scope, deliberately:** the live adversarial injection pass. It needs credentials and a
deployed endpoint, and it stays a launch gate in `docs/deploy.md` §Known deferrals. Hardening the
surface does **not** discharge the gate.

---

## 7. D6 — count rows, split the counters, rethrow

**Support:** ARCH `AGREE-WITH-CHANGE` (also count rows, not statements); SEC `AGREE-WITH-CHANGE`
(replace `waitUntil` rather than bolting a `.catch` on it). Complementary, not conflicting — both
adopted.

- **ARCH:** the report noticed that `refreshed += batch.length` (`cron-handler.ts:49`) counts
  statements queued rather than rows matched, and then left it out of the fix. That defeats D6's
  own stated purpose — *"it is a precondition for verifying any B6 fix in production"*. `db.batch`
  returns `D1Result[]` with `meta.changes`; summing it is two lines. SEC added the concrete failure
  mode: the `UPDATE` is keyed `WHERE tmdb_id = ? AND content_type = ?`, so a drifted `content_type`
  matches zero rows and still counts as refreshed.
- **SEC:** adding `.catch` to `ctx.waitUntil(...)` gets a log line but keeps the invocation
  reporting **success** to Cloudflare's cron metrics. `await` inside
  `try { } catch { log; throw }` marks the Cron Trigger invocation failed in the dashboard — a free
  monitoring surface that otherwise does not exist. Cron invocations get 15 minutes, so awaiting is
  safe.
- **ARCH's correction to the report's framing**, recorded so nobody over-plans on it: a `waitUntil`
  rejection is not literally invisible, because `wrangler.jsonc` has `observability.enabled: true`
  with `invocation_logs`, so the scheduled invocation records an `exception` outcome. A named
  `cron_failed` line is still worth two lines — you should not have to go looking — but *"no signal
  at all"* overstated it, and plans built on overstated premises tend to grow.

The fetch/write error split is the core of D6's option B, which both reviews endorsed. Without it a
single `{"refreshed":0,"errors":200}` line cannot distinguish a TMDB outage from a D1 write
failure.

**Rejected:** full per-title error attribution with sampled error strings (option C) — scope creep.

---

## 8. D7 — one chunked `IN()` for the profile PUT

**Support:** ARCH `AGREE`, SEC `AGREE`. No divergence.

Verified: `user/profile/route.ts:118-126` runs `SELECT 1 FROM titles WHERE tmdb_id = ?` in a
sequential `for` loop over up to 100 deduped ids, on the ritual's "Continue →" button
(`ritual/page.tsx:132` blocks the step on the PUT). Up to 99 removable round-trips from the most
latency-visible button in the flow.

**SEC's implementation note, adopted:** preserve `unknownIds` ordering by iterating `referenced` and
testing against a `Set` built from the results — **not** by iterating the results.
`MAX_UNKNOWN_IDS_PER_PUT` and the `failedIds` response body are both order-visible.

`content_type = 'movie'` is a SQL literal, not a bound parameter, so `D1_IN_CHUNK_SIZE = 90` has
full headroom.

**ARCH's mild disagreement, noted and set aside:** landing it "in the same change as D2" is fine
but not important — different files, no shared code. What matters is that both go through
`chunk` / `D1_IN_CHUNK_SIZE`. They are grouped together anyway because the chunking discipline is
one reviewable idea.

---

## 9. B1 + B4 — one change: read first, claim atomically, loser gets no cookie

**Support:** ARCH `AGREE-WITH-CHANGE` (offered two cheaper shapes and recommended abandoning
rotation); SEC `AGREE-WITH-CHANGE` (specified a precise grace shape and ruled out the alternatives).
**Divergence: substantial.** SEC's shape was taken.

**What both agreed on:**

- B1 and B4 are the same twelve lines of `auth.ts` and the same `sessions` table. Landing them
  independently means writing the rotation twice and reviewing it twice.
- The report's *"issue the replacement row in the same `db.batch` as the delete"* **does not work as
  written**. ARCH: the `INSERT` needs `user_id`, which only arrives via the `DELETE … RETURNING`,
  and batching an unconditional `INSERT` behind a `DELETE` that matched zero rows destroys the
  single-winner property. SEC: `batch()` executes prepared statements and a later statement cannot
  consume an earlier one's `RETURNING` output — *"so 'just batch them' doesn't compile."*
- Moving the `SELECT email FROM users` (`auth.ts:135-138`) **before** any mutation is most of the
  B4 fix, because that read sitting inside the destroy-then-recreate window is the largest
  contributor to it.

**SEC's rulings that closed off the alternatives:**

- **Widening the session cookie is a non-fix.** The failing check is `verifyJWT` (`auth.ts:96`) on
  an **expired JWT**; a longer `Max-Age` just makes the browser send a dead token and fall through
  to the same rotation path. Ruled out.
- **Retry is structurally impossible, not merely slow.** The winner's new refresh token exists only
  as a SHA-256 hash in the row and as plaintext in the *winner's* `Set-Cookie`. The loser can never
  obtain the plaintext, so it can never mint a valid cookie no matter how long it waits. Any retry
  design collapses into "the loser also rotates".
- **"The loser also rotates" is worse than the bug.** `/ritual` fires three concurrent
  authenticated requests; all three would mint distinct 90-day refresh tokens, the browser keeps
  whichever `Set-Cookie` lands last, and the other two stay valid and unreferenced for 90 days.
  That is a real replay-surface expansion.

**Where they diverged, and why SEC won.**

ARCH argued the grace-window shape is *"the single largest change in this campaign"* — a migration,
a new token lifecycle, a new security surface — and recommended instead **abandoning rotation**:
replace destroy-then-recreate with an idempotent `UPDATE sessions SET expires_at = ? WHERE
token_hash = ? RETURNING user_id`. All N concurrent requests succeed; no cookie churn; **B4
disappears entirely** rather than being mitigated. Roughly five lines. ARCH's own framing of the
trade was fair: rotation shortens the window a leaked refresh token stays useful, but the current
implementation *derives no detection benefit from rotation* — `auth.ts:120-125` deliberately treats
an unknown token as "nothing happened" — so today you pay the race and the B4 window for a property
you are not collecting on.

**Resolution: keep rotating; take SEC's shape.** ARCH's option is genuinely simpler and it is the
better engineering answer *if* rotation-on-refresh is negotiable. But it is a change to the
session-security posture, not a bug fix, and this campaign's mandate is to fix the bugs the hunt
found — not to re-decide the auth model while Sam is away. Abandoning rotation is the kind of
decision that needs its own conversation. SEC's shape fixes both bugs, changes nothing about what
`user: null` means to the 13 call sites, and creates zero extra refresh tokens.

**The shape, as SEC specified it:**

1. Nullable `rotated_at TEXT` on `sessions`.
2. Read first: `SELECT s.user_id, s.expires_at, s.rotated_at, u.email FROM sessions s JOIN users u
   ON u.id = s.user_id WHERE s.token_hash = ?`. Every read that can fail now happens before any
   write.
3. Claim atomically in one `db.batch([...])`: `INSERT … SELECT` (sourcing `user_id` from the row,
   so there is no data dependency on `RETURNING`) followed by
   `UPDATE sessions SET rotated_at = ? WHERE token_hash = ? AND rotated_at IS NULL`. The UPDATE's
   `meta.changes` is the single-winner arbiter, and `batch()` makes the pair atomic.
4. Winner sets cookies as today. **Loser** (`changes === 0`), inside a 30 s grace window with
   `expires_at > now`: return `{ user, headers }` with **no `Set-Cookie` at all** — the winner
   already set them. Outside the window: today's behavior.
5. Opportunistically prune rows with `rotated_at < now − grace`.

30 s is ample for a `Promise.all` fan-out and two-tab navigation. The reuse window is the standard
refresh-token-rotation accommodation for network races (RFC 6819 / OAuth BCP), and it is a much
smaller widening than the app's current posture, which has no reuse detection or family revocation
at all.

**Test consequence both reviews flagged:** `auth.test.ts:375` asserts the loser's 401 as *correct
behavior*, with the comment *"CRITICAL: must NOT clear cookies"*. It must be **rewritten**, not
extended.

**Migration numbering correction:** ARCH allocated `0003` for B6 and noted B1 would need one too.
In fact `migrations/` contains only `0001_initial_schema.sql` — the `0002_auth_schema.sql` both
reviews assumed exists was stale `CLAUDE.md` boilerplate, corrected on `dev` at `61f1f93`. Since B1
does need a migration and G1 merges before G4, the plan allocates **`0002` to B1**
(`sessions.rotated_at`) and **`0003` to B6** (`titles.last_refresh_attempt_at`) — so B6 lands on
the number the reviews named, for a different reason than they gave, and no number is skipped.
`0001` is **not** edited: it has already been applied to the remote database (`docs/deploy.md` §2),
so a change there would fail on `CREATE TABLE … already exists` and never reach production.

---

## 10. B2 — gate the match POST on live membership; leave the read on `session_members`

**Support:** ARCH `AGREE`, SEC `AGREE`. No divergence on substance.

SEC articulated the privacy line best, and it is worth preserving verbatim in spirit: the join
page's promise — *"Joining … shares your taste profile with its other members"*
(`groups/join/[code]/page.tsx:94`) — is about **the act of sharing at a point in time**. A stored
round is a record of a shared evening the ex-member was legitimately part of; revoking their view
of it destroys their history to protect data they already saw. What is *not* covered by that
promise is deriving a **new** analysis from **post-split** data, on the account owner's Anthropic
spend, up to the 10-round budget. **Write/spend authority must track live membership; read access
to a completed round should not.**

Both reviews confirmed the asymmetry is unintentional rather than policy:
`getGroupDetailForMember` (`groups.ts:132-150`) checks `group_members` and 404s an ex-member, while
`getSessionForMember` joins `session_members` and both callers use it.

**ARCH's two additions, adopted:**

1. Give the 403 a `kind` and add it to `ERROR_FRAMING` (`results/[sessionId]/page.tsx:51-62`).
   Without one it falls to `DEFAULT_FRAMING` = "That didn't work" **with `retry: true`** — a retry
   button that can only ever fail again. The map already carries non-`MatchingError` kinds
   (`monthly_cap`, `round_limit`), so this is in pattern.
2. The copy should say what happened ("You've left this group") rather than a generic refusal —
   because the user *can* still read the session, and an unexplained refusal next to visible content
   reads as a bug.

**Hard boundary both reviews drew:** do **not** push the check into `getSessionForMember`. That
would also close the history read, which `dev/plans/design-doc.md:275` explicitly preserves.

---

## 11. B3 — flip the ordering *and* the union, raise the cap

**Support:** ARCH `AGREE-WITH-CHANGE`, SEC `AGREE-WITH-CHANGE`. Both caught the same omission
independently, and it is the one that makes the difference.

**The report's part (1) as stated does not fix the bug.** Adding `ORDER BY round_number DESC` to
`getAccumulatedRemovedIds` puts the newest *prior* rounds first — and then `match/route.ts:117-119`
appends **this round's** removals at the *end* of the union, so the entries the user just rejected
are still the first thing `slice(0, 50)` throws away. **The union order must flip too.** Both
changes, or neither works.

**SEC's cap argument, adopted.** A formatted entry is `"Title (tmdbId 12345)"` — roughly 25-35
characters, call it ~10 tokens. Fifty entries ≈ **500 tokens**. The `CANDIDATES` block is up to 200
lines at roughly 35-45 tokens each — **7,000-9,000 tokens**. The exclusion list is under 6% of the
block it sits beside, and the reachable legitimate ceiling is 10 rounds x 7 recommendations = 70.
Fifty is arbitrarily tight for the one guarantee the product advertises. **Cap at 100.** Not
uncapped: `removedTmdbIds` is client input (§2a), so an unbounded list is an unbounded prompt.

**Both reviews on the shared helper:** `clampTitleList` is used at four call sites
(`matching.ts:233, 234, 277, 278`). Flipping the slice direction *globally* would be a no-op for
the member comfort/watchlist uses (already server-capped at 50 by `user/profile/route.ts:11`), but
fixing at the producer is cleaner than making a shared helper direction-aware. The plan therefore
adds a dedicated `MAX_REMOVED_TITLE_ENTRIES = 100` applied only to the exclusion list, and keeps
`slice(0, N)` — what changes is that the *input* is newest-first.

**ARCH's sequencing note, adopted into the plan's wording:** once D1's structural filter lands,
this is belt-and-braces rather than the enforcement mechanism. Still worth doing — the prompt line
is user-visible model reasoning — but it must be described that way so nobody concludes the
`ORDER BY` alone was sufficient.

---

## 12. B5 — scrub the name at delete time, structured **and** free text

**Support:** ARCH `AGREE-WITH-CHANGE` (**do not** build a scrubber; do a render-time placeholder
and soften the copy); SEC `AGREE-WITH-CHANGE` (structural scrub insufficient, blanking
unacceptable, scrub both at delete). **This is the sharpest disagreement in the review pair.**
**SEC's position was taken.**

**ARCH's case against the scrubber** was about cost and reliability: it means reading every
recommendation row for that user's sessions, JSON-parsing, regex-replacing a name out of free prose,
and writing back — *"inside a Worker, over an unbounded row set, irreversibly, to satisfy a
sentence you are free to rewrite."* ARCH proposed instead: a render-time "Former member"
placeholder (the session GET already knows which members are live, because
`getSessionMembersWithProfiles` drops deleted users via `JOIN users`), plus correcting the copy at
`profile/page.tsx:235`, `privacy/page.tsx:90` and `design-doc.md:62` to say what is actually true.
*"At zero users the promise costs nothing to weaken and everything to keep falsely."*

**SEC's case against each cheaper option:**

- A **structural-only scrub** (`tasteMap.members[].name`) leaves the name in prose the *same page*
  renders two tabs over. It makes the copy **more** misleading, not less, because a user who checks
  the taste map sees the placeholder and concludes the promise was kept.
- A **render-time placeholder** has exactly the same gap, and additionally requires the session GET
  to publish a list of deleted userIds — new API surface, same hole.
- **Blanking or regenerating `conversational`** is not acceptable: regenerating spends money and
  produces a different evening's write-up; blanking contradicts the *other half of the same
  promise* — *"so the group's history survives without you in it"* / *"their history doesn't
  develop holes"*. Destroying the survivor's record to satisfy the deleter's is not a trade the
  copy offers.
- **Softening the copy** is legitimate in principle but poor here: `privacy/page.tsx:89-91` is the
  concrete, checkable claim, and *"we remove your name from the structured summary but the written
  recap may still mention you"* is a promise nobody would read as privacy-preserving.

**Resolution.** ARCH's "unbounded row set" is the crux, and it does not hold at Phase 1 scale: the
row set is (sessions the user was a member of) x (≤10 rounds each), which is bounded and small.
With that removed, ARCH's argument reduces to "the copy is cheaper to change than the behavior" —
true, but the behavior is what the user was promised at the moment of an **irreversible** action,
and this app's entire pitch to a couple is that it handles their taste data carefully. The honest
minimum is the scrub.

SEC's implementation constraints, all adopted:

- **Ordering is not optional.** The scrub must run **before** the existing `db.batch`. The batch
  anonymizes `session_members.user_id` (the join key needed to find the rows) and deletes the
  `users` row (where the name lives). Wrong order silently scrubs nothing. Scrub-first is also the
  safe failure order: a partial scrub leaves the account undeleted and the operation retryable.
- **Guard on `name.length >= 2`** so a one-character display name cannot shred the prose.
- **Word-boundary, case-insensitive literal replacement** across the serialized document — this
  catches `conversational`, `overlap.summary` and per-pick explanations in one pass and handles
  possessives correctly.

**One SEC recommendation declined:** rewriting `tasteMap.members[].userId` to match the
`session_members` sentinel. The userId is not rendered anywhere (`taste-map.tsx` keys off `useId`),
and making the two agree would require moving the per-row sentinel generation out of SQL for no
user-visible benefit.

**Consequence:** because the scrub makes both statements true, the privacy and profile copy for B5
does **not** change. (The *separate* B14 copy problem still does — see §16.)

---

## 13. B6 — sweep oldest-first; never stamp a freshness the user can see

**Support:** ARCH `AGREE-WITH-CHANGE` (two changes, one of them flagged hardest); SEC did not opine
separately beyond the tier interaction. ARCH's shape was taken.

**ARCH's hard flag, and it is the decision that matters here.** The report proposed "record an
attempt timestamp … on the error path", which reads as though `last_refreshed_at` could carry it.
It cannot: `last_refreshed_at` is **rendered to the user** — `asOfNote(title.lastRefreshedAt, now)`
prints *"as of 4 Jul 2026"* on a pick's streaming line (`ranked-list.tsx:34-42`, called at `:137`).
Stamping it on a *failed* fetch makes the UI assert a freshness that never happened — turning an
observability gap into a user-facing lie, on exactly the field the design doc's *"where to watch
info that's actually correct"* criterion is about.

Correct shape: a separate `last_refresh_attempt_at TEXT` column, stamped on **both** paths, with the
staleness predicate keyed off it. A migration is free at zero users. The alternatives are worse:
stamping `last_refreshed_at` lies to the user, and repurposing the unused `updated_at` column is
exactly the naming-by-history CLAUDE.md forbids.

**Ordering:** `ORDER BY last_refreshed_at ASC, popularity DESC` in preference to the report's
either/or *"oldest-first **or** split the budget"*. SQLite sorts NULLs first on `ASC`, so
never-successfully-refreshed rows lead; `popularity DESC` is then a within-run tiebreaker, which
preserves what popularity ordering was actually for (`selectCandidates` only ever surfaces the
popularity head). One clause, no budget-splitting arithmetic.

**Interaction with §1, recorded by SEC:** at 40/week against a ~1,000-title seed a full sweep takes
25 weeks *even after* this fix. Ranks 201+ going stale is B6; ranks 41+ going stale for half a year
is a different, worse product outcome. Another reason 200 stays.

---

## 14. B7 — `MONTHLY_MATCH_LIMIT=0`

**Support:** ARCH `AGREE`. Uncontroversial: one line, one route, zero risk, and it is the one value
that expresses "kill switch armed".

**ARCH's addition, adopted:** reject negatives too. `-1` currently reads as "unlimited" by accident
(`-1` is truthy, and `count >= -1` is always true), which is the same class of bug pointing the
other way.

---

## 15. B8 — the note must not claim what the engine did

**Support:** ARCH `AGREE-WITH-CHANGE` — and ARCH's finding here is the important one: **the
report's proposed fix is a privacy regression.**

`weightingApplied: boolean` on `SessionView` is serialized to **every** member by
`movie-sessions/[id]/route.ts:44-49`. In a two-person group, a member who did not toggle and reads
the JSON learns `weightingApplied === true`, and therefore that their partner toggled. That is
precisely the invariant `DESIGN.md` §Rough-Day Toggle protects (*"The generosity stays invisible"*,
lines 122-124) and that VC5 verified was intact. The fix would reintroduce, over the wire, the exact
leak the 2026-07-19 decision-log entry was written to close.

ARCH proposed serializing the already-ANDed value instead:
`weightingNoteVisible = ownRoughDay && toggledCount > 0 && toggledCount < liveMemberCount`, plus a
hard coupling to B9's users-joined member count (otherwise B8 re-creates B9's bug in a second
place, because the engine's `toggledCount === members.length` check runs over
`getSessionMembersWithProfiles`, which drops deleted accounts).

**The plan does not do this, and the reasoning is worth recording.** The ANDed field is safe for the
*non*-toggler — it is always `false` for them, so they learn nothing. But it is **not** safe for the
toggler. Alice knows her own flag is set; in a two-person group the field is `true` exactly when Bob
did **not** toggle. So the field is, for Alice, a direct readout of Bob's private flag. More
generally: **any note that is both truthful about the engine and shown to the toggler leaks the
other member's toggle.** Truthfulness-about-the-engine and the privacy invariant are in direct
conflict; there is no field, name, or serialization that resolves it.

The reconciled decision anticipated this and set suppression as the fallback. The plan takes a
better branch: **stop making the claim.** `DESIGN.md:124` already specifies what this note is meant
to be — *"shown exclusively to the person who set the toggle, **describing their own choice back to
them**"*. The shipped copy (*"tonight's picks lean toward everyone else"*) over-claims against the
design system's own words. Rewording it to describe the request rather than the outcome is true in
both the applied and the cancelled case, carries no information about anyone else's flag, and needs
**no `SessionView` change at all**.

Consequence: the B8↔B9 hard coupling ARCH identified dissolves, because the derivation
(`session.roughDay && response.tasteMap.members.length > 1`) no longer depends on a live member
count. They stay in the same execution group anyway, so that a reviewer who prefers the gated-field
shape can reinstate it in one place.

**This is the plan's one substantive deviation from the reconciled decision text.** It is flagged
as such in the plan (§10) and should be overridden explicitly if Sam disagrees.

---

## 16. B9 and B14

**B9 — `member_count` must join `users`.** ARCH `AGREE`: the proposed subquery is correct and
minimal, moves both callers in the right direction, and `movie-sessions.test.ts:365-398` keeps
passing. No divergence.

SEC's ordering note (11.5), adopted: **do B5 before B9**, so B9's catch-test can assert the full
post-deletion state — `solo: true`, no name in the blob, count agrees with
`getSessionMembersWithProfiles(...).length` — in one fixture instead of two.

**B14 — do NOT delete orphaned groups. Fix the copy.**
**Support:** ARCH wanted **both** (a) and the copy fix. SEC found the reachable sequence that kills
(a). **SEC's finding wins.**

- **ARCH** correctly noted that option (a) alone does not make the copy true — a shared group with
  a surviving member is correctly *not* deleted, so *"This deletes your profile, your groups and
  your sign-in"* still overstates — and that (a) is not a one-statement addition to the existing
  batch, because `group_members` cascades away as part of the same `DELETE FROM users`, so by the
  time an "which groups are now empty" statement runs, the rows identifying this user's groups are
  gone.
- **SEC (11.2)** then found the sequence that makes (a) unsafe at any level of care. `groups` →
  `movie_sessions` → `recommendations` / `session_members` all CASCADE. "Empty" is defined by
  `group_members` — and a member who **left** via `leaveGroup` has no `group_members` row but
  *does* still have `session_members` rows and, per the B2 decision, a legitimate read of that
  history. **A and B share a group → A leaves → B deletes their account → the group is "empty" →
  CASCADE destroys every session and round A could still read.** That is exactly the history the
  design doc and the B2 decision both say to preserve, destroyed as a side effect of someone else's
  action.

SEC offered safer predicates (`no live group_members AND no surviving session_members pointing at a
live user`, or "delete only when no `movie_sessions` reference it"). The decision declines all of
them: the copy is one sentence, this is a greenfield app with no users, and a destructive CASCADE
guarded by a hand-written predicate is not a trade worth making to avoid rewriting a sentence.

Both reviews independently endorsed the `__solo__` guard in `leaveGroup` as a cheap, separate
improvement. The reconciled decision text is silent on it; the plan includes it and marks it
droppable.

---

## 17. B10, B11, B12, B13, B15

**B10 — client-side count limits.** ARCH `AGREE-WITH-CHANGE`. The fix copies a pattern already in
the repo (`quick/page.tsx:94-106, 244-250`: refuse the tap, say why, `aria-live`). ARCH verified the
arithmetic: 16 `MOOD_TAGS` + 14 `GENRE_TAGS` = exactly 30 presets against `MAX_TAG_LIST_ENTRIES = 30`,
so selecting every chip plus one custom tag is a reachable 31.

ARCH's requested change — extract `50` and `30` into `src/config/limits.ts` rather than adding a
fourth and fifth copy — was **declined**. ARCH's own execution-grouping section identifies the
problem with it: that file would be imported by `matching.ts`, `user/profile/route.ts`,
`match/route.ts` and two components, i.e. four groups, turning a two-component change into a
cross-group refactor with a rebase cost paid by everyone. The plan passes the values as props from
the five render sites instead. If the duplication is to be consolidated, it should be its own
change.

**B11 — clear `sessionId`, do not reuse it.** ARCH `DISAGREE` with the report, and ARCH is right.
`movie_sessions.mood_vibes` / `mood_text` / `discover_new` are written once at creation
(`movie-sessions.ts:89-101`) and never updated, and `runMatch(sessionId)` re-runs the **stored**
brief. Reusing the id means the user presses **"Change the vibe"** (`quick/page.tsx:186` — that is
the literal label), changes their tags, presses the CTA, and gets a match against the vibe they just
abandoned. *"That trades a cheap orphan row for a wrong answer, which is a bad trade in a product
whose entire value is the answer."* The "but the round budget resets" objection is not a defect: a
new mood is a new brief, and per-session round counting is the correct granularity for it. A
session-mood PATCH endpoint is the only option preserving both properties, and it is
over-engineered for Phase 1. Orphaned zero-round rows are accepted debris on a greenfield app —
documented, not cleaned up.

**B12 — no insert retry.** ARCH `AGREE-WITH-CHANGE`, and this is a hard boundary.
`insertRecommendation` mints a fresh `crypto.randomUUID()` PK (`movie-sessions.ts:337`), so a retry
after a commit-then-lost-response writes the round **twice** — inflating `getRoundNumber`,
`getAccumulatedRemovedIds` and the monthly cap. *"A blind retry of a non-idempotent insert on the
app's only spend path is the riskiest line in the whole plan."* Log the serialized response so the
round is recoverable, and stop. (ARCH noted that keying `recommendations.id` on
`${sessionId}:${round}` would make a retry safe and would convert the accepted round-limit TOCTOU
into a PK conflict — a pleasant side effect, and a separate decision.)

The `getTitlesMap` → `{}` fallback is free: `ranked-list.tsx:129-132` already renders
`pick ${index + 1}` for an unhydrated title, so partial data is contract-compatible.

**B13 — one predicate, both paths.** ARCH `AGREE`. One implementation detail worth pinning: the read
path **dereferences before it validates** — `route.ts:39-41` calls `response.recommendations.map(...)`
immediately after `parseJsonColumn`. The guard has to sit between those two lines, not merely
"somewhere in the route".

SEC's 11.6, adopted: degrading a corrupt row to `response: null` is good UX (the results page renders
"Nothing picked yet" with a working CTA) but it turns a data-corruption event into a **silent** one,
and `insertRecommendation` failures are already invisible per B12. Log a structured line when the
read-path guard rejects a stored row. It is the only signal you would ever get.

**B15 — deterministic identity, separate statements.** ARCH `AGREE-WITH-CHANGE` (make the **primary
key** deterministic, not just the invite code, then both inserts become idempotent on constraints
that already exist); SEC `AGREE-WITH-CHANGE` (**do not batch the two inserts** — D1 enforces FKs, so
on the losing racer the `INSERT OR IGNORE INTO groups` is ignored while the batch's second statement
still points at a never-created id, the batch rolls back, and the exception surfaces as a 500 on the
exact double-tap the fix exists to handle).

The reconciled decision takes **both**: deterministic group id **and** the three-step non-batched
sequence. With a deterministic PK the FK hazard SEC described cannot arise, so the sequencing is
belt-and-braces — but it costs nothing and it keeps the code robust if the id derivation ever
changes. The re-`SELECT` is by `invite_code`, so it is a genuine authoritative read rather than a
tautology.

SEC verified joinability is preserved by **two independent guards**: `POST /api/groups/join` rejects
the code before any DB access (`CODE_FORMAT = /^[2-9A-Za-z]{8}$/`, and `solo-<uuid>` is 41 characters
with hyphens), and `joinGroup`'s query excludes `__solo__` by name regardless of its code. Nothing
surfaces the solo invite code either.

**The client-side double-submit guard on `/quick`'s CTA is NOT added.** ARCH: `submit()` calls
`setMatching(true)` first, which re-renders into the `PhasedLoading` branch and unmounts the button;
React has committed long before a human's second tap lands. The window is sub-frame. SEC agreed it
"is not the fix". Adding a `disabled` state would also create one more call site for the disabled-
treatment normalisation to police.

---

## 18. The canonical disabled treatment

**Support:** ARCH proposed it; there was no competing proposal. Adopted as stated.

Six different treatments across six files today, including two different opacity values
(`disabled:opacity-50` at four sites, `disabled:opacity-60` at one, `slate`/`ash` at two).

**The rule:** *A disabled control leaves the amber hierarchy. It is not a dimmed CTA; it is chrome.
Filled controls drop the amber fill to `slate` with an `ash` label. Outlined controls drop their
`ash` boundary to `slate` with an `ash` label. Hover is neutralised. Opacity is never used to
express disabled.*

Why this and not opacity:

1. **It reuses token semantics the design system already has.** `slate` = inactive, `ash` = muted
   text. Opacity is mechanical dimming outside the token vocabulary, and nothing in `DESIGN.md` can
   say whether 50 or 60 is right — which is exactly why both exist in the tree today.
2. **It matches the brief.** *"Amber is the candlelight."* A 50%-opacity amber slab is still the
   loudest object on a midnight screen; it reads as *broken*, not *not yet*. Dropping to slate makes
   the button recede, which is what "unhurried clarity" wants.
3. **`DESIGN.md` already anticipated it.** The 2026-07-27 accessibility decision (`DESIGN.md:132`)
   names *"disabled controls"* as a sanctioned home for `slate`. The two sites already using it
   (`profile/page.tsx:27`, `refine-panel.tsx:111`) are the ones that read the design system.
4. **Two levels, not one, because the resting states differ.** `bg-slate` on an outlined button
   invents a filled state it does not have; `border-slate` on a filled button does nothing. Same
   rule, each level's own vocabulary — a two-tier scheme falling out of the existing three-tier
   model, not a new axis.

WCAG 1.4.3 and 1.4.11 both exempt inactive components, so contrast here is a legibility judgement,
not a conformance gate. `ash` on `slate` measures **4.06:1** — below the 4.5:1 text floor that does
not apply, comfortably legible, and consistent with `control-contrast.test.tsx:88`, which already
asserts `contrastRatio(ash, slate) >= 3`.

**The companion edit that will otherwise burn an hour:** `control-contrast.test.tsx`'s `ALLOWED` map
counts `-slate` occurrences **per file** and asserts **exact equality**. Centralising moves counts —
`components/control-classes.ts` becomes a new entry, `app/profile/page.tsx` and
`components/refine-panel.tsx` both drop. The test fails loudly, which is the point, but the plan
says so up front. The `disabled:hover:*` neutralisers are also load-bearing: `:hover` still matches
a disabled button, and Tailwind resolves `hover:bg-warm-white` vs `disabled:bg-slate` by **variant
order**, not specificity.

---

## 19. Execution grouping and merge order

**Support:** ARCH proposed the regrouping; the reconciled decision adjusted it. Both are recorded so
the difference is visible.

ARCH's constraints, all adopted:

- **`src/components/control-classes.ts` and the slate allowlist must be owned by exactly one group.**
  §18's normalisation was in no group in the original split.
- **`src/lib/movie-sessions.ts` is touched by up to four groups** and
  `src/app/api/movie-sessions/[id]/route.ts` — a 56-line file — by three. The plan resolves this by
  naming the exact functions each group may modify (plan §1.3) rather than by re-splitting.
- **B2's only fix site is `match/route.ts`**, so it belongs with the matching group, not the
  sessions group. Its other touch is one new helper in `groups.ts`.
- **Migration numbers must be allocated up front** or two groups both claim the same one.
- **`src/test/fake-d1.ts` failure injection is a shared prerequisite** spanning the auth and matching
  groups — land it once, first.
- **B1 → B4** in the same group, in that order.
- **D1 → B3** in the same group, described accurately so nobody stops at the `ORDER BY`.

ARCH also required **B8 and B9 in the same group**, because `weightingNoteVisible` would have to be
computed against B9's users-joined count. §15's copy fix dissolves that dependency, but the plan
keeps them together anyway so a reviewer who prefers the gated-field shape can reinstate it in one
place.

**Merge order chosen: PREP → G1 → G4 → G6 → G2 → G3 → G5.** PREP unblocks G1/G2/G4; G1 and G4 touch
files nobody else does and are the highest-severity and schema-bearing changes respectively; G6
owns the design-system files and touches `ritual/page.tsx`, so it precedes G5; G2 precedes G3
because both touch `movie-sessions.ts` and `groups.ts` and G2 introduces the `isGroupMember` helper;
G5 rebases onto everything.

---

## 20. Housekeeping

`src/lib/db.ts:2` (*"Ported from twin-cities-tee-times"*) and `vitest.config.ts:2` (*"Mirrors
twin-cities-tee-times' setup"*) are provenance, not description. CLAUDE.md forbids temporal and
historical context in comments and requires each file to open with two `ABOUTME:` lines describing
what it does. Replaced with accurate descriptions.

O1 from the bug hunt — `CLAUDE.md`'s `tct-` cookie prefix, which the code has never used — was
already fixed on `dev` at `61f1f93` and is not part of this campaign.

---

## 21. Post-reconciliation additions (2026-08-01, after the decisions above were settled)

Two further reviews landed on `dev` while this plan was being written. Neither reopens a decision
above; both add scope, and the reasoning for how that scope was shaped is recorded here.

### 21.1 The performance audit (`dev/reports/2026-08-01-performance-audit.md`, PR #12)

**It confirmed B7 live.** §1.5: `MONTHLY_MATCH_LIMIT` was set to `0` in `.dev.vars` on the
assumption that it disables matching. `wrangler dev` does not hot-reload `.dev.vars`, and one
`POST …/match` ran the full D1 pipeline into `callClaude` and reached `api.anthropic.com`, which
returned `401 authentication_error: invalid x-api-key`. No tokens, no cost — the key was the
literal string `not-set-do-not-call`. B7 is no longer a code reading; it is an observation.

**And it surfaced a secondary defect (new task G2-5b).** `callClaude`'s catch
(`matching.ts:424-434`) maps 429, 529 and ≥500 and re-throws everything else, so a `401`/`403`
escapes the taxonomy and reaches the user as a generic `500 "Match failed"` with no distinct log
signal. A revoked or rotated API key is therefore indistinguishable from a database failure or a
route bug.

The contract question — can the locked error taxonomy absorb this, or does it need a new kind? —
was decided **new kind**, on three grounds:

1. `ERROR_FRAMING` (`results/[sessionId]/page.tsx:51-62`) is a `Map` with a `DEFAULT_FRAMING`
   fallback and **already carries kinds that are not `MatchingErrorKind`s** (`monthly_cap`,
   `round_limit`). The contract is locked in the sense that the UI branches on `kind`, not in the
   sense that it is closed to additions.
2. There is no honest existing home. `overloaded` and `timeout` both tell the user "try again in a
   moment", which for a revoked credential is advice that can never work; `malformed` is simply
   false.
3. `MATCHING_ERROR_HTTP` is a `Record<MatchingErrorKind, …>`, so TypeScript *forces* the route to
   handle a new kind. The compiler is the guardrail that makes the addition safe.

The user-facing string deliberately reuses the `timeout`/`overloaded` copy — the user must not be
told about our credentials — and `retry: true` is kept even though a retry cannot fix a revoked
key, because from the user's side it is indistinguishable from a transient outage and a dead end is
worse for the far more common case where an operator is mid-rotation.

**G7 — what was taken and what was left.** Tier A items A1-A4 and Tier B items B1-B2 became G7.
The larger Tier B items were deferred and are listed in the plan's §9 with their reasons. Two are
worth restating here because the temptation to fold them in is real:

- **Batching the match route's five independent reads (Tier B B3)** genuinely interacts with B12 —
  it shrinks the window that bug lives in. It was still deferred: 3-4 h with test churn, and
  landing a concurrency change inside a bug-fix diff makes both harder to review.
- **Cron fetch concurrency (Tier B B7)** — the audit explicitly recommends folding it into the
  B6/D6 cron work "so the cron is touched once". Declined. G4 already carries a migration, an
  ordering change, a new failure-path write and a counter rewrite; adding a concurrency model to
  the same diff is how a schema change gets reviewed carelessly. It is not a correctness or billing
  risk today (cron wall clock is 15 minutes and CPU excludes I/O wait).

**One audit hedge that this plan overturns.** §3.1 recommends *keeping* `idx_movie_sessions_group`
even though nothing reads it, on the grounds that it backs the `ON DELETE CASCADE` from `groups`,
"which bug-hunt B14's fix would start exercising". §16 of this document decided **not** to delete
orphaned groups, and no Phase 1 code path deletes a `groups` row at all — so the cascade the hedge
protects never fires. G7-5 drops the index.

**The `_headers` caveat is load-bearing and is written into the task.** The `max-age=0` behaviour
was observed under `wrangler dev`, not production. It matches Workers Assets' documented default,
but the plan requires the fix to be described as *expected*, not *confirmed*, until a `curl -I`
against the first real deploy says otherwise.

### 21.2 The authenticated-surface a11y verification (`dev/reports/2026-08-01-authenticated-a11y-verification.md`, PR #13)

Two real WCAG 2.2 AA failures, now recorded at `docs/accessibility.md:11` as
`❌ Open — must fix for AA` — a count that moved 0 → 2, the project's first open AA items. Both are
1.4.10 Reflow content-loss at 320px, both caused by Tailwind `truncate`, and both are in G5.

**GAP-1 (`/groups` invite link, 79px / ~25% clipped at 320px, still 23px at 375px) is the one with
teeth.** Not because of the criterion — because the comment above `copyInvite`
(`groups/page.tsx:212-213`) justifies having no clipboard-failure fallback on the explicit grounds
that *"the link is rendered in full above the button, so it stays selectable by hand."* Below
roughly 400px that is false, so a user whose clipboard write fails cannot read the one value the
page exists to give them. It gets worse in production: the measurement used a 21-character
`http://127.0.0.1:8791` origin. The fix must restore full readability **and** selectability at
320px. A `title` attribute is explicitly rejected — unavailable on touch, on an app whose primary
breakpoint is 375px mobile, and it does not satisfy a criterion about content in the reflowed
layout.

**GAP-2 (`/tonight` member list, 43px clipped at 320px only)** is the same class at lower severity
and gets the same class of fix.

**GAP-3 (`/ritual` current-step label, 28px, 320px only, 27-character name)** is left alone: the
report classes it marginal, the full string is in the accessibility tree, and
`progress-steps.tsx`'s `sr-only` treatment of non-current steps is called out as a *correct*
pattern.

**The methodological finding matters more than either bug, and is written into both tasks.**
`truncate` clips with **no scrollbar and no overflow**, so comparing
`document.scrollingElement.scrollWidth` against its `clientWidth` — the check three prior reflow
passes used — walks straight past it. The report only found these because it additionally swept for
descendants with `text-overflow: ellipsis` and `scrollWidth > clientWidth` **on the element's own
box**. Compounding it: **jsdom has no layout engine**, so both metrics are 0 and a jsdom test
*cannot* prove either fix. The plan therefore requires a class/structure assertion plus an explicit
comment saying so, with geometric confirmation done through the report's Part 1 signed-in runbook.
A test that appeared to prove the fix would be worse than no test.

**Two corrected facts, adopted wherever this plan reasons about the chip grid:** it is **30 chips
(16 mood + 14 genre)**, not the "~18" the closed section of `docs/accessibility.md` states, and
chips sit on **charcoal (5.44:1)**, not midnight (6.21:1). Both still clear the 3:1 that 1.4.11
requires, so no decision changes — but the numbers do. The historical section of
`docs/accessibility.md` is deliberately **not** rewritten; only the open-AA rows move, and only
when G5 closes them.

---

## 22. Corrections made during plan review (three adversarial rounds)

The plan was reviewed for subagent-readiness over three rounds — one self-review and two rounds of
independent adversarial review by fresh agents with no conversation history, verifying every claim
against the source. Four findings changed the *substance* of a decision above rather than merely
the plan's wording, and are recorded here so the decision record and the plan do not drift.

1. **B1's grace check must re-read `rotated_at` after the claim, not reuse the pre-claim read.**
   §9's shape reads the row *before* mutating (which is what fixes B4). In the real race, the
   loser's read happens before the winner's `UPDATE`, so its `rotated_at` is `NULL` — evaluating
   the grace window against that value sends the loser down the `{ user: null }` path and **B1 is
   not fixed at all**. Worse, the only test the synchronous fake D1 permits (call, then call again)
   passes either way. The plan now mandates a re-read and boxes the failure mode.

2. **B1's two claim statements must carry identical predicates, and the INSERT is the arbiter.**
   As first written, statement 2 lacked `expires_at > ?`. A row expiring between the read and the
   batch would make the INSERT no-op while the UPDATE reported `changes: 1` — minting a cookie for
   a session row that does not exist, which is the permanent-401 wedge B4 exists to remove.

3. **B5's scrub must operate on the parsed object over four named prose fields, never on the
   serialized JSON document.** The security review's "word-boundary literal replacement across the
   serialized document" is wrong three ways, all irreversible: JSON **keys** match the lookarounds
   (a user named `name`, `summary` or `userId` corrupts the document's structure); it reaches
   *every* member's `name`, not just the deleted one's; and it rewrites film titles and prose in
   the survivor's record. The plan now scopes it to `conversational`, `tasteMap.overlap.summary`,
   `tasteMap.members[].summary` and `recommendations[].explanation`, and suppresses the free-text
   pass entirely when another member shares the name.

4. **B6's failure-path attempt stamp must not ride D6's `refreshed` counter.** Queuing the
   attempt-only `UPDATE` on the same array that D6 sums `meta.changes` over would make a run where
   every TMDB fetch fails log `refreshed: 200` — the exact lie D6 exists to remove, in the same
   commit that removes it.

Two further corrections are worth recording because they were premises, not details:

- **`migrations/` contains only `0001`.** Both sanity reviews assumed a `0002_auth_schema.sql`
  from stale `CLAUDE.md` boilerplate. Since B1 also needs a migration, the allocation is
  `0002` → B1, `0003` → B6, `0004` → the performance-audit indexes — so B6 still lands on the
  number the reviews named, and no number is skipped. `0001` is not edited: it has been applied
  remotely, so a change there would fail on `CREATE TABLE … already exists`.
- **`docs/deploy.md` §2 is headed "Apply the schema — ✅ DONE".** Three pending migrations appended
  under a heading marked DONE is how production ends up without `sessions.rotated_at`, which would
  turn every token refresh into a 500. The plan makes the first group to touch the file create an
  explicit *Pending migrations* subsection.
