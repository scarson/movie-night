# Performance Audit — Phase 1, Pre-Deployment Baseline

**Date:** 2026-08-01
**Base:** `dev` @ 822e8af (worktree `perf-audit`, branch `claude/perf-audit`)
**Scope:** execution-cost mapping of the hot paths, index review, bundle/cold-start, local
measurement, frontend delivery.
**Status of the app:** nothing is deployed. There is no production telemetry, no prior audit, and
no baseline. This document *is* the baseline.

This audit changed no application code. It is analysis, measurement and artifacts only.

---

## 0. How to read this document

Every number below is either (a) a **static count** derived by reading the code, or (b) a
**local measurement** taken on a MacBook against `wrangler dev` with real bindings and a
synthetic catalog. Local numbers are labelled as such everywhere they appear.

**Local `wrangler dev` timings are not production latency.** In local dev the Worker and D1 run in
the same `workerd` process against an on-disk SQLite file; a D1 query costs microseconds and
involves no network. In production every D1 call is a network round trip from the Worker to the
database, and Cloudflare's own changelog describes cross-region D1 latency as "an outsized latency
factor"
([D1 Worker API latency](https://developers.cloudflare.com/changelog/post/2025-01-07-d1-faster-query/),
[D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).

The practical consequence, and the thesis of this audit:

> **At this app's data scale, SQL execution time is irrelevant and the number of sequential D1
> round trips is everything.** The heaviest query in the codebase executes in 0.1 ms against a
> 1,000-title catalog. The most expensive *path* issues up to 20 of them one after another.

Local timings are therefore reported as **relative cost indicators**, and the audit ranks findings
by *round-trip count* and *serialisation depth*, not by measured milliseconds.

---

## 1. Methodology

### 1.1 What was done

| Step | Tool / command | Notes |
|---|---|---|
| Dependency install | `npm install --no-audit --no-fund` | Clean worktree, exit 0 |
| Static path mapping | Read of all 15 route files + `src/lib/*.ts` | Every `.prepare()` / `fetch()` enumerated by hand |
| Index review | `EXPLAIN QUERY PLAN` on all 33 distinct statements | Against real schema in local D1 |
| Client bundle | `npm run build` + parse of `.next/server/app/*.html` | Next 16 / Turbopack no longer prints a per-route size table; asset lists were recovered from the prerendered HTML, which is ground truth for what a browser fetches |
| Worker bundle | `npx @opennextjs/cloudflare build`, then `npx wrangler deploy --dry-run --outdir=…` | Wrangler reports the real upload size |
| Bundle composition | esbuild metafile at `.open-next/server-functions/default/handler.mjs.meta.json` | 450 inputs, grouped by package |
| Local server timings | `npx wrangler dev --port 8977`, 25 iterations/case after 3 warm-ups | Real D1 binding, real Worker runtime |
| Query timings | `node:sqlite` against the local D1 file, 100–300 iterations/query | Isolates SQL cost from HTTP/runtime cost |
| Scale probe | Separate SQLite DB seeded to 20,000 titles / 50,049 recommendations over 10,041 sessions | Shows which queries degrade and which do not |
| Frontend | Browser pane against `http://127.0.0.1:8977`, Resource Timing + PerformanceObserver | Signed-out surfaces only |
| Platform facts | `search_cloudflare_documentation` | Cited inline |

### 1.2 Port and worktree isolation

A second agent was concurrently running an authenticated-surface verification in the
`auth-surface-verification` worktree, on **port 8791**. This audit used **port 8977** (inspector
9977) throughout and never touched 8791. The browser pane held two tabs; all instrumentation was
run against `tab-1` (127.0.0.1:8977) with an explicit `tabId`, and the other agent's tab was never
fronted or navigated.

### 1.3 Seed data

`npm run seed:local` could not be used: it fetches TMDB discover pages and per-title detail, and
there is no TMDB token in this environment. A synthetic seed was generated instead, sized to match
what the real seeder produces (`scripts/seed.ts`, `DEFAULT_PAGES = 50` ≈ 1,000 titles):

- 1,000 `titles` with 300–900-character synopses, realistic `streaming` / `top_cast` / `keywords`
  JSON, and a monotonic `popularity` spread
- 2 `users` with full profiles (50 comfort + 50 watchlist ids each — the documented per-list cap)
- 1 two-person group plus a `__solo__` group
- 41 `movie_sessions`; one "hot" session carrying 9 rounds of realistic `ai_response` blobs
  (~5 KB each) and a 200-id `candidate_snapshot`
- 49 `recommendations`, 500 `rate_limit_log` rows

Schema applied with `npm run migrate:local` (`migrations/0001_initial_schema.sql`).

Authenticated routes were exercised by minting a local HS256 JWT against a throwaway `JWT_SECRET`
written into a gitignored `.dev.vars`. No real credential was used or created.

### 1.4 What could NOT be measured, and why

| Not measured | Reason |
|---|---|
| **Production latency of anything** | Nothing is deployed. Every timing here is localhost. |
| **Anthropic call latency, token counts, cost per round** | No API key; instructed not to call. The 5–15 s budget in `dev/plans/design-doc.md` is the only estimate available. This is the single largest unknown in the app's latency profile and it dominates the match path. |
| **TMDB fetch latency** (profile-PUT enrichment, weekly cron) | No token; instructed not to call. Cron cost is therefore modelled from the request count, not timed. |
| **Real D1 round-trip cost** | Local D1 is in-process. Production per-query cost is a network RTT that this audit cannot observe. |
| **Worker startup (cold-start) time** | `wrangler deploy` reports "Worker Startup Time" only on a real deploy. Local first-request latency (99 ms vs 5 ms warm) reflects miniflare bootstrapping, not workerd isolate startup, and is not reported as a cold-start number. |
| **FCP / LCP / real CLS** | The browser tab was backgrounded (the other agent's tab held the foreground), so Chrome deferred rendering: `first-paint` reported 3,084 ms while `domContentLoadedEventEnd` was 88.7 ms. Paint-dependent metrics from this run are artifacts and are excluded. Resource Timing, render-blocking classification, font-load status and the request waterfall are visibility-independent and *are* reported. Observed CLS was 0, which is a valid *upper* bound only for the parts that did render. |
| **Authenticated-page frontend behaviour** | Out of scope by instruction (a second agent covers authenticated surfaces). Client bundle composition for gated routes was derived statically instead. |
| **Multi-group N+1 amplification** | Only one group was seeded. The `getGroupsForUser` N+1 is reported from code, not measured at N > 1. |

### 1.5 One incident worth recording

While attempting to measure the match route's pre-AI portion, `MONTHLY_MATCH_LIMIT` was set to `0`
in `.dev.vars`, on the assumption that this would disable matching. `wrangler dev` does not hot-
reload `.dev.vars`, and one `POST /api/movie-sessions/ms-hot/match` proceeded through the full D1
pipeline into `callClaude`, which reached `api.anthropic.com` and received
`401 authentication_error: invalid x-api-key`. No tokens were consumed, no cost was incurred, and
the "key" in play was the literal string `not-set-do-not-call`.

Two things follow, both useful:

1. It is a **live confirmation of bug B7** (`dev/bug-hunts/2026-08-01-phase1-consolidated.md`):
   `MONTHLY_MATCH_LIMIT=0` does not disable matching. The kill switch cannot be armed with the one
   value that means "off". After restarting with `MONTHLY_MATCH_LIMIT=1`, the route correctly
   returned `429 {"kind":"monthly_cap"}` in 3.7 ms without contacting Anthropic.
2. An Anthropic `401` is **not** in `MATCHING_ERROR_HTTP`'s taxonomy (`callClaude` maps only 429,
   529 and ≥500), so it re-throws and the user gets a generic `500 "Match failed"`. That is
   arguably correct — a bad API key is an operator error, not a user-facing condition — but it
   means a revoked or rotated key surfaces as an unexplained 500 with no distinct log signal.

---

## 2. Execution-cost map of the hot paths

Legend: **seq** = the query/fetch is awaited before the next one starts. Everything in this
codebase is `seq` unless explicitly noted; there is **no `Promise.all` and no `db.batch` for reads
anywhere in `src/lib` or `src/app/api`**. `db.batch` is used only for writes
(`createGroup`, `createSoloGroup`, `createMovieSession`, `deleteAccount`, the cron flush).

D1 calls count as subrequests. Per
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/): "A subrequest is any
request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or **D1**."
Workers Free = 50 subrequests/invocation and 1,000 to internal services; Workers Paid = 10,000 by
default (the old 1,000 cap was removed 2026-02-11).

### 2.1 `POST /api/movie-sessions/[id]/match` — the matching request

Modelled for a 2-member group, both members carrying the maximum 50 comfort + 50 watchlist titles.

| # | Operation | Location | D1 | External | Order | Notes |
|---|---|---|---|---|---|---|
| 1 | `authenticateRequest` — valid JWT | `auth.ts:95-100` | **0** | 0 | — | fast path, CPU only |
| 1′ | `authenticateRequest` — refresh path | `auth.ts:115,135,154` | **3** | 0 | seq | DELETE⟶RETURNING, SELECT email, INSERT — three serial round trips, entered on every request after 15 idle minutes |
| 2 | `getSessionForMember` | `movie-sessions.ts:169` | 1 | | seq | |
| 3 | `getRoundNumber` | `movie-sessions.ts:117` | 1 | | seq | independent of #2 |
| 4 | `countMatchesThisMonth` | `movie-sessions.ts:139` | 1 | | seq | **full table scan — no index** (§3) |
| 5 | `getSessionMembersWithProfiles` | `movie-sessions.ts:229` | 1 | | seq | independent of #2–4 |
| 6 | `getAccumulatedRemovedIds` | `movie-sessions.ts:126` | 1 | | seq | independent of #2–5 |
| 7 | `selectCandidates` — popularity pool | `matching.ts:85` | 1 | | seq | `LIMIT 250` |
| 8 | `selectCandidates` — referenced-id chunks | `matching.ts:101` | 0–3 | | seq | `ceil(missing/90)`; up to 200 referenced ids |
| 9 | `getTitlesMap(all member refs)` | `match/route.ts:122` | 1–3 | | seq | up to 200 ids ⟶ 3 chunks. **Re-reads titles #7/#8 already loaded.** |
| 10 | `formatTitleRefs(keptTmdbIds)` | `match/route.ts:145` | 0–1 | | seq | ≤50 ids |
| 11 | `formatTitleRefs(allRemovedIds)` | `match/route.ts:146` | 0–2 | | seq | accumulated removals + this round's, up to ~110 ids |
| 12 | `runMatching` ⟶ `callClaude` | `matching.ts:487` | 0 | **1–4** | seq | `MAX_ATTEMPTS = 2` app-level × SDK `maxRetries: 1` |
| 13 | `insertRecommendation` | `movie-sessions.ts:330` | 1 | | seq | |
| 14 | `getTitlesMap(recommendations)` | `match/route.ts:164` | 1 | | seq | 6 ids |
| | **Total** | | **10 – 20** | **1 – 4** | **all sequential** | +3 D1 if the auth refresh path fires |

Observations:

- **Serialisation depth 10–20 D1 round trips, zero parallelism.** Steps 2–6 are mutually
  independent — nothing in #3, #4, #5 or #6 consumes #2's result — and could collapse into a single
  `db.batch()`. Steps 7–11 depend only on #5's profile data and could collapse into roughly two.
  A realistic restructuring is **20 ⟶ 5** round trips with no behaviour change.
- Steps 10 and 11 are evaluated inside the object literal passed to `runMatching`. Object property
  evaluation is ordered, so those two awaits are serial with each other *and* with #9, even though
  all three are just `getTitlesMap` calls that could share one query.
- **Step 9 is redundant work.** `selectCandidates` (#7, #8) has already loaded every referenced
  title's row into memory — including `title` — but returns a shape without a lookup map, so the
  route re-queries the same rows to build `titlesForNames`.
- **Subrequest budget is not at risk.** Worst case ≈ 24 subrequests against 10,000 (Paid). Even on
  Free, 20 internal (limit 1,000) and 4 external (limit 50) fit.
- **CPU time is not at risk either.** Per Cloudflare, CPU time excludes time awaiting I/O, so the
  5–15 s spent waiting on Anthropic costs nothing against the 30 s CPU limit. The real CPU work
  here is prompt string construction over ~200 candidates and `JSON.stringify` of the response —
  small.
- **What actually costs the user time:** 1–4 Anthropic calls (seconds each) ≫ 10–20 D1 round trips
  (tens to low hundreds of ms in production) ≫ SQL execution (< 1 ms total, measured).
- The bug hunt's **D3** (no wall-clock deadline around up to 4 Sonnet calls) is the dominant
  tail-latency risk on this path and is already in the remediation plan's scope. Not duplicated
  here.

### 2.2 Results page load (`/results/[sessionId]`)

The page is a client component. It renders nothing until `useAuth()` resolves, then fetches.

| # | Request | Depth | D1 | Notes |
|---|---|---|---|---|
| 1 | `GET /api/auth/me` (from `AuthProvider`, root layout) | 1 | 1 | `SELECT name, avatar_url FROM users WHERE id = ?` |
| 2 | `GET /api/movie-sessions/[id]` | **2** | 3 | gated on `user` being non-null (`results/page.tsx:93-95`) |
| 2a | ↳ `getSessionForMember` | | 1 | |
| 2b | ↳ latest round, `SELECT *` | `[id]/route.ts:34` | 1 | see below |
| 2c | ↳ `getTitlesMap(6 ids)` | | 1 | |
| | **Total** | **2 serial HTTP round trips** | **4** | |

- **The two HTTP requests are serial, not parallel.** `AuthProvider`'s effect fires on mount; the
  results page's effect early-returns `if (!user)`. So the browser does auth/me, waits, then does
  the session GET. On a mobile connection this is two full RTTs before any content exists. The
  same shape applies to `/tonight`, `/groups`, `/profile`, `/quick` and `/ritual`.
- **`SELECT *` at `[id]/route.ts:34` over-fetches.** The row carries `ai_response` (~5 KB) *and*
  `candidate_snapshot` (a 200-integer JSON array, ~1.4 KB) *and* `kept_tmdb_ids`,
  `removed_tmdb_ids`, `steering_feedback`, `model`, `prompt_version`. The route uses exactly two
  of those columns (`ai_response`, `round_number`). Roughly a third of the bytes crossing the D1
  wire on every results load are discarded.
- Measured locally: `GET /api/movie-sessions/ms-hot` = **2.2 ms median**, 6,817-byte response.

### 2.3 Ritual flow

#### 2.3.1 Ritual page load (`/ritual?group=…`)

| # | Request | Depth | D1 | Notes |
|---|---|---|---|---|
| 1 | `GET /api/auth/me` | 1 | 1 | |
| 2 | `Promise.all([fetchProfileDraft, fetchQuickPicks, fetchGroup])` | 2 | | genuinely parallel — the one place the app does this |
| 2a | ↳ `GET /api/user/profile` | 2 | 1 | |
| 2b | ↳ `GET /api/titles/search?popular=1` | 2 | 1 | |
| 2c | ↳ `GET /api/groups/[id]` | 2 | 3 | membership probe, group row, member list — sequential inside the route |
| 3 | ↳ `GET /api/titles/search?ids=…` | **3** | 1 | chained inside `fetchProfileDraft` after 2a returns |
| | **Total** | **3 serial HTTP round trips** | **7** | |

`fetchProfileDraft` (`session-flow.ts:67-92`) is a two-request chain: fetch the id lists, then
resolve them. That makes the ritual's critical path three requests deep. The ids are already known
to the server at step 2a — the profile GET could return hydrated titles and remove a whole tier.
This also interacts with bug B1: three simultaneous authenticated requests at step 2 is exactly
the fan-out that loses the refresh-token rotation race.

#### 2.3.2 The Continue button (`PUT /api/user/profile`) — bug D7

This is the most latency-visible button in the app: `ritual/page.tsx:128-140` blocks the step
transition until the PUT returns.

| # | Operation | Location | D1 | External | Order |
|---|---|---|---|---|---|
| 1 | `authenticateRequest` | | 0 (or 3) | | seq |
| 2 | **existence probe, one per referenced id** | `user/profile/route.ts:120-126` | **up to 100** | | **seq, in a `for` loop** |
| 3 | TMDB enrichment for unknown ids | `route.ts:139-171` | up to 10 writes | up to 10 | seq, interleaved |
| 4 | profile upsert | `route.ts:179` | 1 | | seq |
| | **Total** | | **2 – 121** | **0 – 10** | all sequential |

Measured locally (`wrangler dev`, 25 iterations, all ids already known so no TMDB traffic):

| Payload | Median | p90 | Max | Δ vs baseline |
|---|---|---|---|---|
| 0 title ids | **2.4 ms** | 3.0 | 3.3 | — |
| 50 known ids | **9.8 ms** | 11.1 | 18.6 | +7.4 ms |
| 100 known ids | **16.7 ms** | 23.1 | 24.9 | **+14.3 ms** |

That is ~0.14 ms per D1 round trip *in-process*. The identical query measured at the SQLite layer
costs **0.001 ms** — so 99% of the observed cost is per-call overhead, not SQL. In production that
per-call overhead is a network RTT rather than a function call. This is the finding the local
harness is best at: it isolates the *shape* of the problem (100 serial calls) from the *SQL*
(free), and shows that the fix is round-trip elimination, not query tuning.

The fix (one chunked `IN (...)`, 100 ⟶ 2 round trips) is bug-hunt item **D7** and belongs to the
remediation plan, alongside **D2** (`resolveIds` unchunked at exactly the 100-parameter ceiling).
Both are referenced, not re-specified here.

### 2.4 Groups page (`/groups`)

| # | Request | Depth | D1 | Notes |
|---|---|---|---|---|
| 1 | `GET /api/auth/me` | 1 | 1 | |
| 2 | `GET /api/groups` | 2 | **1 + N** | |
| 2a | ↳ `getGroupsForUser` group list | `groups.ts:154` | 1 | |
| 2b | ↳ `fetchMembers` **per group, in a `for` loop** | `groups.ts:166-169` | N | **N+1** |

`getGroupsForUser` awaits `fetchMembers` inside a sequential `for` loop. A user in 5 groups costs 6
serial round trips instead of 2. The set is user-controlled and unbounded — nothing caps how many
groups an account may join. Measured at N=1: **2.5 ms median**. At Phase 1 scale (a couple has one
group) this is a 2-query path and genuinely does not matter; it is filed as a scale item, with the
note that the fix is a single `JOIN`, not a loop.

`/tonight` uses the same `GET /api/groups` endpoint and inherits the same shape.

### 2.5 Profile page (`/profile`)

| # | Request | Depth | D1 |
|---|---|---|---|
| 1 | `GET /api/auth/me` | 1 | 1 |
| 2 | `Promise.all([fetchProfileDraft, fetchQuickPicks])` | 2 | 2 |
| 3 | ↳ `GET /api/titles/search?ids=…` (chained) | **3** | 1 |

Same three-deep waterfall as the ritual, same root cause (`fetchProfileDraft` is two chained
requests). Measured: `GET /api/user/profile` **1.8 ms**, `GET /api/titles/search?ids=<100>`
**2.2 ms**.

### 2.6 Weekly cron (`0 9 * * 1` ⟶ `runWeeklyRefresh`)

| # | Operation | Location | D1 | External | Order |
|---|---|---|---|---|---|
| 1 | stale-titles `SELECT` | `cron-handler.ts:25-32` | 1 | | |
| 2 | `fetchMovieDetail` **per title** | `cron-handler.ts:57` | | **200** | **strictly sequential** |
| 3 | `db.batch` flush every 25 titles | `cron-handler.ts:43-53` | 8 | | seq |
| | **Total** | | **9** | **200 external** | |

- **209 subrequests, 200 of them external.** On **Workers Free that is fatal**: the external
  subrequest limit is 50 per invocation. The code comment at `cron-handler.ts:6-9` already
  anticipates this and instructs lowering `STALE_TITLES_LIMIT` to 40 on Free. Confirmed against
  the docs; treat it as a hard deploy-time gate, not a suggestion.
- **Zero concurrency.** 200 TMDB fetches are awaited one at a time. At a conservative 200 ms each,
  the run takes ~40 s of wall clock. Wall clock is unlimited for Workers and the Cron Trigger CPU
  budget is 15 minutes, and CPU time excludes I/O wait — so this is **not** a correctness or
  billing risk today. It is, however, ~40 s of serial waiting that a modest concurrency limit
  (say 8-wide) would turn into ~5 s, and it becomes a real constraint the moment
  `STALE_TITLES_LIMIT` needs to grow to cover a larger catalog.
- The starvation and error-attribution problems on this path are bug-hunt **B6** and **D6**; not
  duplicated here.
- Local timing of the stale-titles `SELECT`: **0.046 ms** at 1,000 titles, **2.8 ms** at 20,000.

### 2.7 Serialisation summary

| Path | Serial D1 round trips | Serial external calls | Serial client HTTP depth |
|---|---|---|---|
| Match POST | 10–20 (+3 auth refresh) | 1–4 Anthropic | 1 |
| Results load | 4 | 0 | **2** |
| Ritual load | 7 | 0 | **3** |
| Ritual Continue | 2–121 | 0–10 TMDB | 1 |
| Groups / Tonight | 2 + N | 0 | **2** |
| Profile load | 4 | 0 | **3** |
| Weekly cron | 9 | **200 TMDB** | — |

---

## 3. Index review

`EXPLAIN QUERY PLAN` was run against the real schema for all 33 distinct statements in
`src/lib/**` and `src/app/api/**`. Full results below; only the interesting rows are discussed.

### 3.1 Existing indexes

| Index | Table | Used by | Verdict |
|---|---|---|---|
| `idx_sessions_user` | `sessions(user_id)` | OAuth callback session-count cap and oldest-session eviction (`callback/route.ts:164,173`) — confirmed `COVERING INDEX` | **Used, keep** |
| `idx_group_members_user` | `group_members(user_id)` | `createSoloGroup`, `getGroupsForUser` | **Used, keep** |
| `idx_recommendations_session` | `recommendations(session_id)` | `getRoundNumber` (covering), `getAccumulatedRemovedIds`, latest-round lookup | **Used**, but see §3.3 |
| `idx_titles_popularity` | `titles(popularity DESC)` | `selectCandidates` pool, `popularTitles`, title `LIKE` search, cron stale-titles | **Used, hot, keep** |
| `idx_rate_limit_scope_key` | `rate_limit_log(scope, key, at)` | `checkJoinRateLimit` — confirmed `COVERING INDEX` | **Used, keep** |
| `idx_movie_sessions_group` | `movie_sessions(group_id)` | **Nothing in Phase 1.** No statement anywhere selects `movie_sessions` by `group_id`. | **Unused for reads.** It is not dead weight in principle — it backs the `ON DELETE CASCADE` from `groups`, which bug-hunt B14's fix would start exercising — but today it costs write amplification on every session insert and serves no query. Leave it (it's cheap and B14 will use it), but do not add more speculative indexes on the same reasoning. |

The implicit indexes carry more load than the explicit ones, and correctly so:
`titles` PK `(tmdb_id, content_type)` serves every `IN (...)` hydration and the profile-PUT
existence probe as a covering index; `session_members` `UNIQUE(session_id, user_id)` serves both
the member-scoped session lookup and the member-profile join; `group_members`
`UNIQUE(group_id, user_id)` serves the membership probe as a covering index.

### 3.2 The one unindexed predicate on a hot path

```sql
-- src/lib/movie-sessions.ts:139-142  (countMatchesThisMonth)
SELECT COUNT(*) as count FROM recommendations
WHERE created_at >= strftime('%Y-%m-01T00:00:00Z', 'now')
```

```
QUERY PLAN
`--SCAN recommendations
```

A full table scan, executed on **every single match request** — i.e. on the app's most expensive
and most user-visible path. `recommendations` rows are fat (`ai_response` ~5 KB,
`candidate_snapshot` ~1.4 KB), so the scan touches a lot of pages for a column it barely reads,
and the table only ever grows.

Measured:

| Catalog state | `countMatchesThisMonth` median | p90 | max |
|---|---|---|---|
| 49 recommendations (Phase 1 seed) | 0.004 ms | 0.005 | 0.006 |
| 50,049 recommendations (scale probe) | **38.0 ms** | 40.2 | 43.3 |
| 50,049 rows **with the proposed index** | **0.180 ms** | 0.185 | 0.369 |

`SCAN recommendations` ⟶ `SEARCH recommendations USING COVERING INDEX (created_at>?)`. **211×.**
Index size at 50k rows: 1.6 MB.

Honest framing: at Phase 1 volume this costs 4 microseconds and is invisible. 50,000
recommendations means 50,000 Anthropic calls, which at ~$0.04 each is ~$2,000 of spend — the app
would have much bigger problems by then. But this is a one-line schema change with no behavioural
risk, it is the *only* unindexed predicate on a hot path, and the cost curve is linear and
unbounded because nothing ever prunes the table.

### 3.3 Two `USE TEMP B-TREE FOR ORDER BY` on the results path

```sql
-- src/app/api/movie-sessions/[id]/route.ts:34
SELECT * FROM recommendations WHERE session_id = ? ORDER BY round_number DESC LIMIT 1
```
```
QUERY PLAN
|--SEARCH recommendations USING INDEX idx_recommendations_session (session_id=?)
`--USE TEMP B-TREE FOR ORDER BY
```

Bounded at 10 rows by `MAX_ROUNDS_PER_SESSION`, so the sort is trivial and this will never matter
on its own. It is worth noting only because the *same* index change removes it for free (§3.4).

`getGroupsForUser` and `fetchMembers` also build temp b-trees for their `ORDER BY created_at` /
`ORDER BY joined_at`. Both operate on single-digit row counts. **No action.**

### 3.4 Proposed indexes (proposal only — no migration written)

```sql
-- 1. countMatchesThisMonth: the only unindexed predicate on a hot path.
--    Verified: SCAN -> SEARCH ... USING COVERING INDEX. 38.0ms -> 0.180ms at 50k rows.
CREATE INDEX idx_recommendations_created_at ON recommendations(created_at);

-- 2. Replaces idx_recommendations_session. Keeps every current use (session_id is the
--    leading column, so getRoundNumber stays covering) and additionally removes the
--    temp b-tree from the latest-round lookup on the results page.
--    Verified: USE TEMP B-TREE FOR ORDER BY disappears.
DROP INDEX idx_recommendations_session;
CREATE INDEX idx_recommendations_session_round ON recommendations(session_id, round_number DESC);
```

Both were created against the scale probe, re-planned, re-timed, and dropped. Proposal #2 is
strictly a widening — it cannot regress anything that `idx_recommendations_session` serves today.

**Deliberately not proposed:**

- `session_members(user_id)` and `movie_sessions(initiated_by_user_id)`. Both are full scans
  (`account.ts:10,13`), but only during account deletion — a once-per-lifetime operation on a
  small table. Adding indexes to speed up deletion would tax every session write forever. **No.**
- Anything for `title LIKE '%x%'`. A leading-wildcard `LIKE` can never use a B-tree index; the plan
  falls back to walking `idx_titles_popularity` and filtering. Measured: 0.007 ms on a hit,
  **0.051 ms** on a full miss at 1,000 titles, **2.9 ms** on a full miss at 20,000. The real answer
  at scale is FTS5, which is a feature-sized change and unjustified for a 1,000-title catalog.
  Record it, do not build it.
- Anything for `selectCandidates`. It already walks `idx_titles_popularity` and stops at 250 rows:
  **0.095 ms** at 1,000 titles, **0.096 ms** at 20,000 — flat, because `LIMIT` bounds the walk.
  Correctly designed.

### 3.5 Full query-plan results

| Query | Location | Plan |
|---|---|---|
| candidate pool | `matching.ts:87` | `SCAN titles USING INDEX idx_titles_popularity` (bounded by LIMIT 250) |
| candidate referenced-id `IN` | `matching.ts:105` | `SEARCH titles USING INDEX sqlite_autoindex_titles_1` |
| `getTitlesMap` / `resolveIds` `IN` | `movie-sessions.ts:283`, `search/route.ts:58` | `SEARCH titles USING INDEX sqlite_autoindex_titles_1` |
| title `LIKE` search | `search/route.ts:124` | `SCAN titles USING INDEX idx_titles_popularity` |
| `popularTitles` | `search/route.ts:72` | `SCAN titles USING INDEX idx_titles_popularity` (LIMIT 12) |
| profile-PUT existence probe | `user/profile/route.ts:122` | `SEARCH titles USING **COVERING** INDEX sqlite_autoindex_titles_1` |
| profile GET | `user/profile/route.ts:69` | `SEARCH profiles USING INDEX sqlite_autoindex_profiles_1` |
| `getSessionForMember` | `movie-sessions.ts:171` | `SEARCH sm USING sqlite_autoindex_session_members_2` + `SEARCH ms (id=?)` + correlated covering subquery |
| `getSessionMembersWithProfiles` | `movie-sessions.ts:231` | `SEARCH sm` + `SEARCH u (id=?)` + `SEARCH p LEFT-JOIN` |
| `getRoundNumber` | `movie-sessions.ts:118` | `SEARCH recommendations USING **COVERING** INDEX idx_recommendations_session` |
| `getAccumulatedRemovedIds` | `movie-sessions.ts:127` | `SEARCH recommendations USING INDEX idx_recommendations_session` |
| **`countMatchesThisMonth`** | `movie-sessions.ts:141` | **`SCAN recommendations`** ← the gap |
| latest round | `[id]/route.ts:34` | `SEARCH … idx_recommendations_session` + `USE TEMP B-TREE FOR ORDER BY` |
| `createSoloGroup` lookup | `movie-sessions.ts:27` | `SEARCH gm USING idx_group_members_user` + `SEARCH g (id=?)` |
| `createMovieSession` member list | `movie-sessions.ts:73` | `SEARCH group_members USING **COVERING** INDEX sqlite_autoindex_group_members_2` |
| `getGroupsForUser` | `groups.ts:156` | `SEARCH gm USING idx_group_members_user` + `SEARCH g` + temp b-tree |
| `fetchMembers` | `groups.ts:62` | `SEARCH gm` + `SEARCH u (id=?)` + temp b-tree |
| membership probe | `groups.ts:138` | `SEARCH group_members USING **COVERING** INDEX` |
| `joinGroup` by code | `groups.ts:111` | `SEARCH groups USING sqlite_autoindex_groups_2 (invite_code=?)` |
| `checkJoinRateLimit` | `groups.ts:184` | `SEARCH rate_limit_log USING **COVERING** INDEX idx_rate_limit_scope_key` |
| auth rotation claim | `auth.ts:116` | `SEARCH sessions USING sqlite_autoindex_sessions_1 (token_hash=?)` |
| auth user lookup / `auth/me` | `auth.ts:136`, `me/route.ts:19` | `SEARCH users USING sqlite_autoindex_users_1 (id=?)` |
| OAuth user upsert lookup | `callback/route.ts:136` | `SEARCH users USING sqlite_autoindex_users_2 (google_id=?)` |
| OAuth session cap | `callback/route.ts:164` | `SEARCH sessions USING **COVERING** INDEX idx_sessions_user` |
| OAuth session eviction | `callback/route.ts:172` | `SEARCH sessions (token_hash=?)` + list subquery on `idx_sessions_user` + temp b-tree |
| cron stale titles | `cron-handler.ts:27` | `SCAN titles USING INDEX idx_titles_popularity` (LIMIT 200) |
| cron `UPDATE` | `cron-handler.ts:62` | `SEARCH titles USING sqlite_autoindex_titles_1` |
| `deleteAccount` session_members rewrite | `account.ts:10` | **`SCAN session_members`** (accepted — see §3.4) |
| `deleteAccount` movie_sessions rewrite | `account.ts:13` | **`SCAN movie_sessions`** (accepted) |

---

## 4. Bundle and cold start

### 4.1 Worker bundle

`npx @opennextjs/cloudflare build`, then `npx wrangler deploy --dry-run --outdir=…`:

```
Total Upload: 5231.68 KiB / gzip: 1122.74 KiB
```

| Artifact | Raw | Gzip |
|---|---|---|
| **Final Worker upload (what deploys)** | **5,357,241 B (5.11 MiB)** | **1,149,686 B (1.10 MiB)** |
| `.open-next/server-functions/default/handler.mjs` | 3,798,981 B | 971,936 B |
| `.open-next/middleware/handler.mjs` | 111,961 B | — |
| `.open-next/worker.js` (entry shim) | 2,278 B | — |
| `.open-next/assets/` (38 files, ASSETS binding — **not** counted against Worker size) | 1.3 MB | — |
| `.open-next/` total on disk | 25 MB | — |

**Against the platform limit: comfortable.** Workers script size limit is 3 MiB compressed on Free
and 10 MiB on Paid. At 1.10 MiB gzip this is ~37% of the Free ceiling and ~11% of Paid.

Composition, from the esbuild metafile (`handler.mjs.meta.json`, 450 inputs, bytes in output):

| Package | Bytes in `handler.mjs` | Share |
|---|---|---|
| `next` | 1,904,649 | 50.1% |
| `[.next` build output — Turbopack server chunks, app code + bundled deps] | 1,576,738 | 41.5% |
| `react-dom` | 200,335 | 5.3% |
| `[project/other]` (OpenNext runtime, `index.mjs`) | 88,646 | 2.3% |
| `react` | 14,036 | 0.4% |
| `styled-jsx` | 11,624 | 0.3% |
| `@swc/helpers` | 1,466 | — |
| `client-only` | 114 | — |

Largest single inputs:

| Bytes | Input |
|---|---|
| 663,727 | `next/dist/compiled/next-server/app-page-turbo.runtime.prod.js` |
| 233,680 | `.next/server/chunks/ssr/[root-of-the-server]__02l7d_r._.js` |
| 194,269 | `react-dom/cjs/react-dom-server.edge.production.js` |
| 190,611 | `.next/server/chunks/[root-of-the-server]__0y4rnf8._.js` |
| 185,903 | `.next/server/chunks/node_modules_1zvcedj._.js` |
| 181,373 | `next/dist/compiled/next-server/app-route-turbo.runtime.prod.js` |
| 128,475 | `next/dist/compiled/next-server/pages-turbo.runtime.prod.js` |
| 126,268 | `next/dist/compiled/jsonwebtoken/index.js` |
| 108,843 | `.next/server/chunks/ssr/node_modules_next_dist_1enzot_._.js` |
| 83,496 | `next/dist/server/load-manifest.external.js` |

**Reading this honestly: ~92% of the Worker is Next.js and React, not application code.** The
project's own source compiles to roughly 30 KB (`.next/server/chunks/ssr/src_*` ≈ 27 KB). There is
no large dependency to prune — `arctic`, `jose`, `nanoid` and the Anthropic SDK together are a
rounding error next to `app-page-turbo.runtime.prod.js` at 664 KB. `next/dist/compiled/jsonwebtoken`
at 126 KB is pulled in by Next's own image-optimisation path, not by this app's auth (which uses
`jose`).

**Non-lazy imports worth knowing about, even though they are not actionable yet.** All four
runtime dependencies are statically bundled into the single `handler.mjs`; grep confirms
`api.anthropic.com`, `x-api-key`, `anthropic-version`, `oauth2.googleapis.com`, `HS256`,
`customAlphabet` and `api.themoviedb.org` all present. The import chain matters:
`movie-sessions.ts` imports `MATCHING_MODEL` / `PROMPT_VERSION` from `matching.ts`, and
`matching.ts` has a top-level `import Anthropic from "@anthropic-ai/sdk"`. Since
`movie-sessions.ts` is imported by most API routes, **the Anthropic SDK is in the module graph of
routes that never call it** — including `GET /api/groups`. Next/OpenNext lazily requires route
modules at request time, so this does not add per-request work to unrelated routes, and the two
constants could trivially move to their own module. Filed as a hygiene note, not a performance
defect: the measured impact is bundle bytes only, and those bytes are dwarfed by Next itself.

**Cold start could not be measured.** `wrangler deploy` reports "Worker Startup Time" only on a
real deploy; local first-request latency (99 ms vs ~5 ms warm) is miniflare bootstrap, not a
workerd isolate start, and is not a valid proxy. **A 5.1 MiB script that must be parsed at isolate
startup is the thing to watch against the 400 ms startup-CPU limit.** Recommendation: capture the
reported startup time on the first real deploy and record it in this file as the cold-start
baseline. That is a two-minute task and it is the only honest way to get the number.

### 4.2 Client bundles

Next 16 with Turbopack no longer prints the per-route First-Load-JS table. Sizes below were
recovered by parsing the actual `<script>` / `<link>` sets out of each prerendered HTML file in
`.next/server/app/`, which is exactly what a browser fetches.

**Shared by every route:**

| Raw | Gzip | Chunk | Note |
|---|---|---|---|
| 227,523 | 70,990 | `chunks/0olp216guwwei.js` | React + React DOM client |
| 141,580 | 38,564 | `chunks/06m4tge09ao1h.js` | Next App Router client runtime |
| 112,594 | 39,627 | `chunks/0cz1d0mv5g_q7.js` | **`noModule` polyfill — not fetched by modern browsers** (confirmed absent from the Chrome resource list) |
| 54,647 | 12,891 | `chunks/2ueu134vemxj3.js` | |
| 44,414 | 9,234 | `chunks/10i9lejyrua8e.js` | |
| 32,525 | 9,390 | `chunks/0qd0olqvo0sgt.js` | preloaded at `fetchPriority="low"` |
| 10,579 | 4,144 | `chunks/turbopack-*.js` | Turbopack runtime |
| **623,862** | **184,840** | **total shared** | |
| **511,268** | **145,213** | **shared, modern browser** (polyfill excluded) | |

**Per-route, beyond shared:**

| Route | Route-only JS raw | gzip | HTML (gz) | Verdict |
|---|---|---|---|---|
| `/ritual` | 26,834 + 12,966 | **13,026** | 2,846 | heaviest — profile editor + tag/title pickers + mood screen |
| `/profile` | 17,101 + 12,966 | **10,795** | 2,791 | profile editor |
| `/quick` | 12,403 + 12,966 | **9,376** | 2,848 | |
| `/groups` | 11,483 + 12,966 | **8,594** | 2,790 | |
| `/tonight` | 5,292 + 12,966 | **6,969** | 2,785 | |
| `/` | 3,991 + 12,966 | **6,548** | 3,684 | |
| `/privacy` | 12,966 | **4,960** | 4,081 | shared layout chunk only |
| `/_not-found` | 12,966 | 4,960 | 2,767 | |

`chunks/33yfoky_i4c2o.js` (12,966 / 4,960 gz) appears on every user-facing route — that is the
shared layout island (`AuthProvider` + `Nav` + `SiteFooter` + `SkipLink` + `ReducedMotionBoot`).

CSS: a single stylesheet, **29,951 raw / 7,140 gzip**, the only render-blocking resource on the
page. For a Tailwind 4 build across 30 components that is lean.

**Is any route disproportionate?** No. The spread between the lightest and heaviest user-facing
route is 8 KB gzip. `/ritual` at 13 KB of route-specific JS is entirely proportionate to being the
app's most complex screen. **There is no code-splitting problem here.** ~145 KB gzip of shared
React/Next framework is the floor for an App Router app and is not something this codebase chose.

`/results/[sessionId]` and `/groups/join/[code]` are dynamic and have no prerendered HTML to parse;
their client composition is the same shared set plus one route chunk, and nothing in their imports
(`TasteMap`, `RankedList`, `ConversationalView`, `RefinePanel`, `PhasedLoading`) suggests they
would break the pattern.

---

## 5. Local measurements

`npx wrangler dev --port 8977`, real D1 binding, synthetic 1,000-title catalog. 25 iterations per
case after 3 warm-ups. **These are localhost numbers on a MacBook. They indicate relative cost,
not production latency.**

### 5.1 End-to-end response times

| Case | HTTP | min | **median** | p90 | max | bytes |
|---|---|---|---|---|---|---|
| `GET /` (static shell) | 200 | 4.2 | **5.3** | 6.5 | 7.3 | 12,851 |
| `GET /ritual` (static shell) | 200 | 4.3 | **5.3** | 6.9 | 15.8 | 10,876 |
| `GET /profile` (static shell) | 200 | 4.0 | **4.6** | 7.5 | 7.8 | 10,778 |
| `GET /groups` (static shell) | 200 | 4.0 | **4.8** | 5.9 | 9.0 | 10,774 |
| `GET /privacy` (static shell) | 200 | 4.8 | **5.6** | 8.5 | 22.9 | 17,700 |
| `GET /results/ms-hot` (dynamic SSR) | 200 | 2.4 | **2.8** | 3.4 | 3.7 | 10,571 |
| `GET /api/auth/me` | 200 | 1.5 | **2.3** | 2.7 | 6.6 | 80 |
| `GET /api/user/profile` | 200 | 1.5 | **1.8** | 2.8 | 3.4 | 876 |
| `GET /api/groups` | 200 | 1.8 | **2.5** | 3.3 | 5.2 | 219 |
| `GET /api/groups/g-couple` | 200 | 2.1 | **2.7** | 3.6 | 4.1 | 216 |
| `GET /api/titles/search?popular=1` | 200 | 1.6 | **1.9** | 2.5 | 2.7 | 1,049 |
| `GET /api/titles/search?ids=` (100 ids) | 200 | 1.8 | **2.2** | 3.9 | 9.4 | 8,793 |
| `GET /api/titles/search?q=Synthetic` (local hit) | 200 | 1.5 | **1.8** | 2.5 | 3.4 | 873 |
| `GET /api/movie-sessions/ms-hot` | 200 | 1.8 | **2.2** | 3.0 | 3.3 | 6,817 |
| `PUT /api/user/profile` (0 ids) | 200 | 1.9 | **2.4** | 3.0 | 3.3 | 130 |
| `PUT /api/user/profile` (50 known ids) | 200 | 8.6 | **9.8** | 11.1 | 18.6 | 479 |
| **`PUT /api/user/profile` (100 known ids)** | 200 | 15.0 | **16.7** | 23.1 | 24.9 | 828 |
| `POST …/match` (monthly cap armed, no AI call) | 429 | 3.4 | **3.7** | 4.6 | 32.4 | 90 |

Notes: the ~2 ms floor is workerd request handling. Static shells cost ~2.5 ms more than API routes
because the ASSETS binding serves a larger body. `POST …/match` at 3.7 ms with a 429 is the
**pre-AI floor** for the match path (auth JWT verify + 3 D1 queries) — everything beyond that is
the 7–17 further D1 round trips and the Anthropic call, neither of which is measured here.

### 5.2 SQL-level query cost

`node:sqlite` directly against the local D1 file. 300 iterations at Phase 1 scale, 100 at scale.

| Query | 1,000 titles / 49 recs | 20,000 titles / 50,049 recs |
|---|---|---|
| `selectCandidates` pool (250 rows) | 0.095 ms | 0.096 ms |
| `selectCandidates` referenced `IN` (90 ids) | 0.045 ms | 0.048 ms |
| `getTitlesMap` 90-id `IN` | 0.049 ms | 0.054 ms |
| `getTitlesMap` 6-id `IN` | 0.005 ms | 0.008 ms |
| profile-PUT existence probe (×1) | **0.001 ms** | 0.004 ms |
| `LIKE` search, 4 hits | 0.007 ms | 0.010 ms |
| `LIKE` search, 0 hits (worst case) | 0.051 ms | **2.894 ms** |
| `popularTitles` (12) | 0.005 ms | 0.008 ms |
| **`countMatchesThisMonth`** | 0.004 ms | **38.011 ms** |
| `getRoundNumber` | 0.002 ms | 0.004 ms |
| `getAccumulatedRemovedIds` | 0.003 ms | 0.006 ms |
| latest round `SELECT *` | 0.015 ms | 0.018 ms |
| `getSessionMembersWithProfiles` | 0.003 ms | 0.006 ms |
| `getSessionForMember` | 0.002 ms | 0.005 ms |
| cron stale-titles (LIMIT 200) | 0.046 ms | 2.802 ms |
| `checkJoinRateLimit` | 0.002 ms | 0.005 ms |

The comparison that matters: the profile-PUT existence probe costs **0.001 ms of SQL** but
**~0.14 ms per call end-to-end in local dev**, and in production a full network RTT. Two orders of
magnitude of the cost is the call, not the query. Optimise round trips, not SQL.

An earlier scale run attached all 50,000 recommendations to a single session, which produced
`getAccumulatedRemovedIds` = 45 ms and latest-round = 87 ms. Those were **artifacts** of an
impossible distribution (`MAX_ROUNDS_PER_SESSION = 10`) and were discarded; the table above uses a
realistic 5-rounds-over-10,000-sessions spread. Recorded so a future audit does not re-derive the
same false alarm.

---

## 6. Frontend

Measured with the Browser pane against `http://127.0.0.1:8977`, signed out. Paint-dependent metrics
are excluded (§1.4).

### 6.1 Request waterfall on `/`

TTFB 31.1 ms · `domContentLoadedEventEnd` 88.7 ms · 17 resources · HTML 12,851 B (3,987 B on the
wire).

Everything below starts at ~74 ms, i.e. all in one wave off the preload scanner:

| Start | Dur | Encoded | Resource | Blocking |
|---|---|---|---|---|
| 74.4 | 8.1 | 81,704 | Fraunces upright woff2 | non-blocking |
| 74.4 | 10.8 | 42,588 | Satoshi upright woff2 | non-blocking |
| 74.4 | 11.1 | 67,388 | Fraunces italic woff2 | non-blocking |
| 74.5 | 13.5 | **7,139** | **stylesheet** | **blocking** |
| 74.5 | 15.0 | 43,844 | **Satoshi italic woff2** | non-blocking |
| 74.5–74.7 | 17–155 | 9,363 / 9,236 / 38,585 / 71,012 / 4,147 / 4,963 / 1,588 / 12,875 | 8 JS chunks | all `async` |
| 3,016 | 11.7 | 44 | `GET /api/auth/me` | |
| 3,037 | ~16 | 466 / 1,380 / 450 | 3× RSC prefetch `/?_rsc=…` | `next/link` prefetch |

**Exactly one render-blocking resource** — the 7.1 KB stylesheet. Every script is `async`. The
`noModule` polyfill was correctly not fetched. This is a clean delivery graph.

### 6.2 Fonts

`src/app/fonts.ts` loads Fraunces (Google, `axes: ["opsz"]`, `style: ["normal","italic"]`,
`display: "swap"`) and Satoshi (self-hosted variable, upright + italic, `display: "swap"`).

`display: "swap"` is correct — text paints immediately in the fallback and reflows when the webfont
lands. `--font-display: var(--font-fraunces), Georgia, serif` and
`--font-body: var(--font-satoshi), system-ui, sans-serif` give sane fallbacks, and Next generates
metric-adjusted `Fraunces Fallback` / `satoshi Fallback` faces, which is what keeps swap-reflow
from producing layout shift.

**But all four faces are `<link rel="preload">`ed on every route — 235,524 bytes**, more than the
gzipped JS of any route by a wide margin, and the largest single category of first-load bytes.

Browser `document.fonts` status on `/`:

| Face | Bytes | Status on `/` | Used where |
|---|---|---|---|
| Fraunces upright | 81,704 | **loaded** | 18 `font-display` usages without `italic` (`/privacy` headings, section `h2`s, `RankedList` rank numerals and titles, `TasteMap`) |
| Fraunces italic | 67,388 | **loaded** | 21 usages — the wordmark in `Nav` on every page, every page `h1` |
| Satoshi upright | 42,588 | **loaded** | body text everywhere |
| **Satoshi italic** | **43,844** | **unloaded** | **exactly one place in the entire app** |

That one place is `src/components/mood-screen.tsx:141`:
`<dd className="mt-2xs text-sm italic text-ash">{moodText}</dd>` — the echoed mood text on the mood
confirmation screen.

**43,844 bytes (18.6% of the font payload) are preloaded on every page in the app for one italic
`<dd>` on one screen.** Two ways out, both trivial: drop the italic `src` entry and let the browser
synthesise oblique from the variable upright face, or drop `italic` from that one line. Either
removes ~43.8 KB from every first load.

### 6.3 Posters and images

`src/components/poster.tsx` — a plain `<img>` (correct: `next/image` optimisation is unavailable on
Workers, and the `eslint-disable` says so).

**Good:**

- `loading="lazy"` present.
- The frame carries `aspect-[2/3]`, so the box is reserved before the image loads. **No CLS from
  posters** — confirmed by observed CLS = 0 and by there being no `width`/`height` attributes that
  would otherwise be required.
- The no-poster fallback is a styled `div` with the same aspect class, so a missing poster does not
  shift anything either.

**Three concrete gaps:**

1. **The above-the-fold LCP image is `loading="lazy"`.** On the results page `RankedList`
   (`ranked-list.tsx:154`) renders every pick's poster lazily, including pick #1 — which is
   almost certainly the LCP element. A lazy above-the-fold image is deferred until layout confirms
   it is in the viewport, adding a round trip to LCP. The first one or two posters want
   `loading="eager"` + `fetchpriority="high"`.
2. **No `srcset` / `sizes`; the poster width is a single fixed guess.** `RankedList` requests
   `w342` into a grid column of `minmax(0,14rem)` = 224 px (mobile) / `13rem` = 208 px (sm+). At
   DPR 1 that is ~1.5× more pixels than the box can use; at DPR 2 it is under-resolved. TMDB offers
   `w185` / `w342` / `w500`, so `srcset="…/w185… 185w, …/w342… 342w"` plus
   `sizes="(min-width: 640px) 13rem, 14rem"` would let the browser pick, roughly halving poster
   bytes on DPR-1 desktop and sharpening DPR-2 mobile. `TitleSearch` requesting `w92` into a 32 px
   `w-8` span is fine (`w92` is TMDB's smallest).
3. **No `preconnect` to `image.tmdb.org`.** Grep confirms no `preconnect` or `dns-prefetch`
   anywhere in `src/`. The results page fetches 5–7 posters from a third-party origin, and the
   first one pays DNS + TCP + TLS before a byte arrives — on mobile that is commonly 100–300 ms
   added to LCP. One `<link rel="preconnect" href="https://image.tmdb.org" crossorigin>` in
   `src/app/layout.tsx` removes it. This is the cheapest LCP win available on the results page.

`decoding="async"` is also absent; minor, worth adding with the rest.

### 6.4 Static-asset cache headers

Every content-hashed asset comes back with:

```
Cache-Control: public, max-age=0, must-revalidate
```

Observed on `/_next/static/chunks/*.js`, `/_next/static/chunks/*.css`, and
`/_next/static/media/*.woff2`. Meanwhile the prerendered HTML gets `Cache-Control: s-maxage=31536000`
(edge only, nothing for the browser).

These filenames contain content hashes — they are immutable by construction and should be
`max-age=31536000, immutable`. As it stands, **every repeat visit revalidates ~14 assets** (8 JS +
1 CSS + 4 fonts + HTML) and gets 14 conditional 304s. On a warm mobile connection that is 14
round trips of pure latency for zero bytes of content.

Cause: `.open-next/assets/` contains no `_headers` file, and `.open-next/worker.js` does not
rewrite headers for asset responses — they are served by the ASSETS binding with the Workers
Assets default. Workers static assets support a
[`_headers` file](https://developers.cloudflare.com/workers/static-assets/headers/) natively, and
`public/` is copied into the assets root at build time (`public/fonts/` ⟶ `.open-next/assets/fonts/`
is confirmed), so a `public/_headers` containing:

```
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
```

should be all it takes.

**Honesty caveat:** this was observed against `wrangler dev`, not production. The behaviour matches
Workers Assets' documented default, so I expect it to hold — but **verify with `curl -I` against
the first real deploy before treating the fix as confirmed.** If production already sends
`immutable`, this finding evaporates and nothing is lost.

### 6.5 Layout shift and long tasks

- **CLS = 0** on the landing page (upper bound only; see §1.4).
- `animate-rise-fade` uses `opacity` + `transform` only (`globals.css:110-121`) — compositor
  properties, no layout. `prefers-reduced-motion` disables it outright with an explicit,
  well-commented `animation: none`. Correct.
- `Nav` renders `null` while `loading`, then swaps the auth area in. That swap sits inside a
  fixed-height `h-16` flex header on the `justify-between` right edge, so it can only move
  horizontally within its own row. No vertical shift.
- `RankedList` staggers entries with `animationDelay: index * STAGGER_MS`. Since the animation is
  `both`-filled opacity/transform, the boxes occupy their final space from the start. No shift.
- Long-task numbers from this run are invalid (backgrounded tab). Reported so a future audit does
  not mistake them for real: one 2,633 ms "task" at t=229 ms, then 58 ms and 66 ms — the first is
  Chrome batching deferred work for a hidden tab, not hydration cost.

### 6.6 A perceived-latency ceiling worth naming

`PhasedLoading` (`src/components/phased-loading.tsx`) holds phase 0 for a fixed 900 ms and each
subsequent phase for 200 ms once the response has arrived. **The results screen therefore cannot
appear sooner than ~1.5 s after the match request starts, no matter how fast the backend is.**

This is a deliberate design choice ("calm phased loading narrative") and the design doc budgets
5–15 s for the Anthropic call, so in practice the narrative is always the *shorter* of the two.
It is recorded here because it sets the ranking rule for everything else on that path:

> **Backend savings below ~1.5 s on the match path are invisible to the user.** That is precisely
> why the match path's 10–20 serial D1 round trips rank *lower* than the profile-PUT's 100, even
> though the absolute count is smaller — the Continue button has no narrative to hide behind.

---

## 7. Ranked findings

Effort estimates are engineering time for someone who already has the context.

### Tier A — fix before launch

**A1. Static assets are served with `max-age=0, must-revalidate`.** §6.4
14 conditional revalidations on every repeat visit, for content-hashed immutable files. Affects
every returning user on every page, and returning users are the entire model of a couples' app that
gets opened weekly.
*Fix:* a `public/_headers` file, 3 lines. *Verify* against the first real deploy first.
**Effort: 15 min + a `curl -I` check post-deploy.**

**A2. Satoshi italic — 43.8 KB preloaded site-wide for one `<dd>`.** §6.2
18.6% of the font payload; larger than the gzipped JS of any individual route.
*Fix:* remove the italic `src` from `localFont` (browser synthesises oblique), or drop `italic`
from `mood-screen.tsx:141`. Needs a designer's eye on the one affected line.
**Effort: 30 min including a visual check.**

**A3. No `preconnect` to `image.tmdb.org`.** §6.3
The results page — the app's payoff screen — pays a full DNS+TCP+TLS handshake before the first
poster byte. Commonly 100–300 ms of LCP on mobile.
*Fix:* one `<link>` in `src/app/layout.tsx`.
**Effort: 10 min.**

**A4. The LCP poster is `loading="lazy"`.** §6.3
Pick #1's poster is the results page's LCP element and is deferred.
*Fix:* an `eager` / `priority` prop on `Poster`, set for the first one or two entries in
`RankedList`.
**Effort: 45 min.**

**A5. `MONTHLY_MATCH_LIMIT=0` does not disable matching.** §1.5 — this is bug-hunt **B7**
Not a latency finding, but this audit confirmed it live: the request went all the way to
`api.anthropic.com`. It is the spend kill switch, it is unarmed, and it is a two-line fix.
*Already in the remediation plan — flagged here only because the audit produced live evidence.*
**Effort: 15 min (remediation plan owns it).**

**A6. Capture the real Worker startup time on the first deploy.** §4.1
A 5.11 MiB script is parsed at isolate startup against a 400 ms startup-CPU limit, and this audit
could not measure it. Record the number `wrangler deploy` prints, in this file.
**Effort: 5 min, on the first deploy.**

### Tier B — worth doing, low risk, not launch-blocking

**B1. `CREATE INDEX idx_recommendations_created_at`.** §3.2
The only unindexed predicate on a hot path. 38.0 ms ⟶ 0.180 ms at 50k rows (verified).
At Phase 1 volume it saves 4 microseconds — but the cost curve is linear, unbounded, and it sits on
the most expensive request in the app.
**Effort: 20 min (one migration line + apply).**

**B2. Widen `idx_recommendations_session` to `(session_id, round_number DESC)`.** §3.4
Strictly a superset of what exists; removes the temp b-tree from the results-page latest-round
lookup. Bundle with B1 in the same migration.
**Effort: included in B1.**

**B3. Collapse the match route's independent reads into `db.batch`.** §2.1
Steps 2–6 (`getSessionForMember`, `getRoundNumber`, `countMatchesThisMonth`,
`getSessionMembersWithProfiles`, `getAccumulatedRemovedIds`) are mutually independent and currently
cost 5 serial round trips. Steps 7–11 could collapse similarly. Realistic: **20 ⟶ 5**.
Ranked below Tier A because §6.6: the 1.5 s loading narrative hides every millisecond of it. It is
worth doing anyway — it reduces the exposure window for a transient D1 failure mid-request, which
interacts with bug B12.
**Effort: 3–4 h including test updates.**

**B4. Name the columns in `SELECT * FROM recommendations`.** §2.2
`[id]/route.ts:34` pulls `candidate_snapshot` (~1.4 KB) and five other unused columns across the D1
wire on every results-page load. The route uses two columns.
**Effort: 20 min.**

**B5. Add `srcset` / `sizes` to `Poster`.** §6.3
Roughly halves poster bytes on DPR-1 displays and sharpens DPR-2.
**Effort: 1–2 h including a visual pass at both DPRs.**

**B6. Flatten the client fetch waterfalls.** §2.2–2.5
Every gated page is 2–3 serial HTTP round trips deep before content, because pages gate on
`useAuth()` and `fetchProfileDraft` is itself a two-request chain. Having the profile GET return
hydrated titles removes one whole tier from `/ritual` and `/profile`.
Interacts with bug B1 (refresh-token rotation race) — fewer simultaneous authenticated requests is
strictly better for that too. Coordinate; do not land independently.
**Effort: 4–6 h. Discuss the API shape with Sam first — this changes a response contract.**

**B7. Concurrency limit on the cron's 200 TMDB fetches.** §2.6
~40 s of serial waiting ⟶ ~5 s at 8-wide. Not a correctness or billing risk today (wall clock is
unlimited; CPU excludes I/O wait), but it is the constraint that binds first if the catalog grows.
Overlaps the B6/D6 cron fixes already in the remediation plan — **do it in that change, not
separately**, so the cron is touched once.
**Effort: 1–2 h, folded into the existing cron work.**

### Tier C — real, but only at scale; record and move on

**C1. `getGroupsForUser` N+1 (`groups.ts:166-169`).** §2.4
1 + N serial round trips for a user in N groups. At the app's actual shape (a couple, one group)
this is 2 queries. The set is user-controlled and unbounded, so it can degrade — but it degrades
in proportion to a number that in practice is 1–3.
*Fix when convenient:* one `JOIN` replacing the loop. **Effort: 1 h.**

**C2. `title LIKE '%q%'` cannot use an index.** §3.4
0.051 ms on a full miss at 1,000 titles; **2.9 ms at 20,000**. Fires per debounced keystroke in the
title picker. The real answer is FTS5, which is a feature, not a tune-up. Do not build it for a
1,000-title catalog.
**Effort if ever needed: 1–2 days.**

**C3. `rate_limit_log` grows without bound** — bug-hunt **D4**, already scoped there. The index is
correct and covering; the table just never shrinks. Not re-specified here.

**C4. Anthropic SDK in the module graph of routes that never call it.** §4.1
Caused by `movie-sessions.ts` importing two constants from `matching.ts`. Bundle bytes only — the
Worker is at 11% of the Paid size limit and route modules are required lazily, so there is no
measured cost. Move `MATCHING_MODEL` / `PROMPT_VERSION` to their own module if the file is being
touched anyway.
**Effort: 30 min, opportunistic.**

### Already covered by the remediation plan — referenced, not duplicated

| Bug-hunt item | Performance dimension |
|---|---|
| **D7** — profile-PUT N+1 | Up to 100 serial D1 round trips on the ritual's Continue. **Measured here: 2.4 ms ⟶ 16.7 ms locally (+14.3 ms), where the SQL itself is 0.001 ms per call.** The largest single round-trip reduction available anywhere in the app. |
| **D2** — `resolveIds` unchunked at exactly 100 params | Correctness cliff, not latency; measured at 2.2 ms for a full 100-id resolve. |
| **D3** — no deadline on up to 4 Anthropic calls | The dominant tail-latency risk in the app. Nothing bounds it today. |
| **B6 / D6** — cron starvation and error attribution | Fold **B7** (fetch concurrency) into the same change. |
| **B7** — `MONTHLY_MATCH_LIMIT=0` | Confirmed live by this audit (§1.5). |
| **B12** — round discarded if persistence fails after the paid call | **B3** (batching) shrinks the window this bug lives in. |

### Nothing genuinely alarming was found

Worth stating plainly, since the ranked list above is long. The Worker bundle is at 11% of its
limit. No path comes close to any subrequest ceiling. CPU time is nowhere near the cap and, per
Cloudflare, does not accrue while awaiting Anthropic. Exactly one query in the whole codebase lacks
a supporting index, and it costs 4 microseconds at current volume. There is no code-splitting
problem, one render-blocking resource, and zero measured layout shift. Every Tier A item is a
configuration or one-attribute change.

The one structural pattern worth naming as a *habit* rather than a bug: **nothing in this codebase
runs two D1 reads concurrently.** `db.batch` is used correctly for writes and never for reads;
there is no `Promise.all` in any route handler or lib function. That is invisible at localhost
speeds and will be the single largest source of production latency once real D1 network round trips
replace in-process function calls. **B3** is the first instance to fix; the pattern is worth a
convention rather than a one-off.

---

## 8. Raw artifacts for future comparison

Recorded so the next audit can diff rather than re-derive.

```
Base commit                       822e8af
Node                              v26.3.0
Next.js                           16.2.10 (Turbopack)
OpenNext                          @opennextjs/cloudflare 1.18.0 (bundle reports openNextVersion 4.0.2)
Wrangler                          4.105.0
SQLite (EXPLAIN/timing harness)   3.51.0

Worker upload (wrangler dry-run)  5231.68 KiB raw / 1122.74 KiB gzip
worker.js                         5,357,241 B
handler.mjs                       3,798,981 B raw / 971,936 B gzip
middleware/handler.mjs            111,961 B
.open-next/assets                 1.3 MB, 38 files
Bundle: next / app / react-dom    1,904,649 / 1,576,738 / 200,335 B

Client shared JS (all routes)     623,862 B raw / 184,840 B gzip
Client shared, modern browser     511,268 B raw / 145,213 B gzip  (noModule polyfill excluded)
CSS (single, render-blocking)     29,951 B raw / 7,140 B gzip
Fonts preloaded per route         235,524 B (81,704 + 67,388 + 43,844 + 42,588)
Heaviest route-only JS            /ritual, 39,800 B raw / 13,026 B gzip

Seed used for measurement         1,000 titles · 2 users · 41 sessions · 49 recommendations · 500 rate-limit rows
Scale probe                       20,000 titles · 50,049 recommendations over 10,041 sessions

Gates (no source changed)         npx tsc --noEmit          exit 0, no output
                                  npm run lint              exit 0, no output
                                  npm test                  59 files, 615 passed, 2 skipped, 5.90s
```

Local server medians (wrangler dev, port 8977, 1,000-title catalog) are in §5.1; SQL-level query
medians at both scales are in §5.2. Both tables are the intended baselines.

**Next audit should, in priority order:** (1) record the real Worker startup time and production
D1 round-trip latency, which are the two numbers this audit could not obtain and which change every
ranking above; (2) re-run §5.1 and §5.2 unchanged and diff; (3) confirm whether A1's cache-header
finding survives contact with production.
