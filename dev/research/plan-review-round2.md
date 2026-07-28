# Adversarial Plan Review — Round 2 (independent cold read)

**Plan reviewed:** `docs/plans/2026-07-18-movie-night-phase1-plan.md` (945 lines, read end-to-end)
**Reviewer stance:** independent; no conversation history; no edits made to the plan.
**Context consulted:** DESIGN.md, dev/plans/design-doc.md (existence/structure), dev/plans/phase-1-implementation.md (existence), mockup.jsx (lines 720–755 prompt logic), docs/pitfalls/implementation-pitfalls.md, docs/pitfalls/testing-pitfalls.md, CLAUDE.md, docs/git-strategy.md (existence). Reference codebase `/Users/sam/Code/twin-cities-tee-times` spot-checked (package.json, next.config.ts, vitest-setup.ts, src/lib/db.ts:125–150, src/lib/auth.ts, src/lib/auth.test.ts, callback route, logout route, worker.ts, .github/workflows/ci.yml). Anthropic API claims verified against the current claude-api reference (structured outputs, adaptive thinking, model IDs, schema limitations).

## Verified-correct claims (no findings)

These plan claims were checked and are accurate — listed so the next round doesn't re-litigate them:

- `sqliteIsoNow` exists at tee-times `src/lib/db.ts` (lines ~136–141) with the exact strftime format quoted.
- tee-times auth.ts: `tct-session`/`tct-refresh` cookie names, `DELETE FROM sessions WHERE token_hash = ? RETURNING ...` rotation (line 113), `REFRESH_EXPIRY_DAYS = 90`, 15-minute JWT (Max-Age=900), `sha256`/`createJWT`/`validateReturnTo` helpers all present. `src/lib/auth.test.ts` exists, so "port those tests wholesale" is executable. SHA-256("abc") test vector in the plan is correct.
- tee-times callback route uses `ON CONFLICT(google_id) DO UPDATE SET email = ..., name = ...` — the plan's "extend the INSERT ... ON CONFLICT to avatar_url" instruction matches reality. Logout is POST.
- tee-times `worker.ts` matches the plan's template (modulo cron-handler rename); `next.config.ts` is the minimal config with no `initializeOpenNextCloudflareForDev()`, exactly as the plan asserts; `vitest-setup.ts` exists; package.json dependency versions in Task 0.1 match tee-times (including `typescript ^6.0.3`); CI uses node 24, branches `[main, dev]`, has a `proxy-tests` job to drop, and `paths-ignore` with docs paths.
- Anthropic API (Task 5.2): `claude-sonnet-5` is a real, current model ID; `output_config: {effort, format: {type: "json_schema", schema}}` is the canonical non-beta structured-outputs shape on `messages.create`; `thinking: {type: "adaptive"}` is valid on Sonnet 5; the claim that structured outputs don't support `minimum`/`maximum` is correct (numerical constraints unsupported; `additionalProperties: false` + full `required` arrays are required — the plan's schema satisfies both).
- Migration SQL parses as valid SQLite; FK targets and cascade design are internally consistent with Task 2.3's anonymization strategy (session_members.user_id and movie_sessions.initiated_by_user_id deliberately have no FK). The monthly-cap `strftime('%Y-%m-01T00:00:00Z','now')` expression is valid and produces T-separated ISO output that compares correctly against `sqliteIsoNow()`-stored timestamps.
- mockup.jsx lines ~728–750 contain the rough-day weightNote / discoveryNote / ratingsNote / steeringNote logic the plan references; the plan's generalization (never name the toggler) is a documented deliberate change.
- DESIGN.md defines `--midnight`, `--cream`, `--person-a`, `--person-b` etc. — Phase 6 token names resolve.
- `docs/git-strategy.md`, `dev/plans/design-doc.md`, `dev/plans/phase-1-implementation.md` all exist at the referenced paths.

---

## BLOCKER findings

### B1. Task 5.2 — Claude response text extraction is unspecified, and the naive implementation fails 100% of the time on Sonnet 5

**Location:** Phase 5, Task 5.2, "Anthropic call" + "Response parsing" ("`parseMatchingResponse(text, validTmdbIds)`").

**Problem:** The plan shows the `client.messages.create(...)` call and then hands `text` to the parser, but never says how `text` is obtained from `response.content`. On Sonnet 5 with adaptive thinking, `response.content` contains **thinking blocks before the text block** (with `display` defaulting to `"omitted"`, they are present with empty text). A fresh subagent writing the obvious `response.content[0].text` gets `undefined` → `JSON.parse` throws → `MatchingError("malformed")` on **every** call. Unit tests won't catch it (client is injected/faked); it only surfaces in the opt-in live evals (5.3) or Phase 8 — expensive to discover late, and the retry-once logic makes it a double-cost failure.

**Fix:** Specify extraction explicitly in 5.2: `const text = response.content.find(b => b.type === "text")?.text` (throw `MatchingError("malformed")` if absent), and require the fake client used in tests to return a content array that *includes a leading thinking block* so the extraction logic is exercised.

### B2. Task 7.3 — "other members' profiles READ-ONLY summary" has no API to fetch the data

**Location:** Phase 7, Task 7.3: "full ritual on one device shows other members' profiles READ-ONLY summary + their rough-day toggle via memberFlags".

**Problem:** No Phase 5 endpoint returns another member's profile. `GET /api/user/profile` is self-only; `GET /api/groups/[id]` returns members with names/avatars only (and Task 4.2 explicitly minimizes member PII). The locked decision resolves the *write* path but leaves the *read* path unimplementable — a subagent must either invent an endpoint (out of scope, security-sensitive: exposes taste-profile data cross-user) or silently drop the summary (deviation).

**Fix:** Decide in the plan: (a) extend `GET /api/groups/[id]` to include a compact profile summary per member (counts + vibes, member-only route — specify exactly which fields, since dealbreakers/watchlists are semi-private), or (b) drop the read-only summary and show only name + rough-day toggle per member step. (b) is smaller and consistent with the privacy posture; either way, Task 5.4/4.2 and 7.3 must agree.

### B3. Task 7.2 — join confirmation screen needs a code→group-name preview endpoint that doesn't exist

**Location:** Phase 7, Task 7.2: "then confirm join screen (group name only) → POST join → redirect to hub".

**Problem:** The group name is only returned by `POST /api/groups/join` **after** joining. There is no endpoint to resolve an invite code to a group name pre-join, so the specified confirm-then-join flow cannot be built. A subagent will either join first and confirm after (wrong UX per spec) or invent an unauthenticated lookup endpoint (a code-enumeration surface Task 4.2's review explicitly worries about).

**Fix:** Either (a) add a `GET /api/groups/join/preview?code=` (authed, same rate limit + format validation as join, returns `{name}` or 404) to Task 4.2/5.4 and note it in the Phase 4 abuse review; or (b) change 7.2 to a confirm screen that shows the code only ("Join group with code XXXX?") and reveals the name after joining.

---

## MAJOR findings

### M1. Task 5.2 — "Musical" does not match any TMDB genre; "all others match by exact name" is factually wrong

**Location:** Phase 5, Task 5.2, candidate selection step 3: "Genre-tag → TMDB genre-name mapping: `Sci-Fi`→`Science Fiction`, `True Crime`→(prompt-level only), `Superhero`→(prompt-level only), all others match by exact name."

**Problem:** TMDB's movie genre list has **"Music"**, not "Musical". A "Musical" dealbreaker would silently exclude nothing at the SQL/candidate layer while the plan claims it's handled there. (All other GENRE_TAGS — Horror, Romance, Sci-Fi(mapped), Animation, Documentary, Western, War, Action, Drama, Fantasy, Mystery — do match exactly.)

**Fix:** Add `Musical`→`Music` to the mapping (or demote Musical to prompt-level like True Crime/Superhero) and add a test asserting every GENRE_TAG resolves to either a real TMDB genre name or an explicit prompt-level marker — the genre map fetched in Task 3.1 makes this testable against the fixture.

### M2. Phase 5 ↔ Phase 7 contract gap — titles map lacks `last_refreshed_at`, which Task 7.5 requires

**Location:** Task 5.4 match response: `titles: { [tmdbId]: { title, year, posterPath, genres, streaming } }` vs Task 7.5: "streaming badges ... with 'as of {date}' suffix when `last_refreshed_at` > 14 days old".

**Problem:** The staleness badge cannot be rendered from the locked API shape. The plan calls the 5.4 shape "locked ... UI consumes exactly this," so a Phase 7 subagent has no sanctioned way to get the date.

**Fix:** Add `lastRefreshedAt: string | null` to the titles-map entry in 5.4 (and to the `GET /api/movie-sessions/[id]` reload payload).

### M3. `__solo__` exclusion is specified in Task 5.4 but belongs to Task 4.1's file and tests

**Location:** Task 5.4: "`getGroupsForUser` (Task 4.1) MUST exclude groups named `\"__solo__\"` from all listings" — but Task 4.1's spec/tests say nothing about it, and Task 5.4's **Files** list does not include `src/lib/groups.ts` / `groups.test.ts`.

**Problem:** A subagent executing 4.1 cold won't implement the exclusion; a subagent executing 5.4 is told the requirement but not told it may modify Phase 4 files (and per standing rule 6 might treat that as out of scope). Sequential execution makes this recoverable but it invites either a missed requirement or an undocumented cross-task edit.

**Fix:** Move the exclusion requirement (and a test: seeded `__solo__` group not returned) into Task 4.1 Step 1, and have 5.4 merely reference it. Alternatively add "Modify: src/lib/groups.ts, src/lib/groups.test.ts" to 5.4's Files list.

### M4. Missing explicit auth boundaries: `/api/titles/search` and session-create membership

**Location:** Task 5.4 API design.

**Problem:** (a) `GET /api/titles/search` never states an auth requirement. As specified it proxies live TMDB search — shipped unauthenticated it's an open proxy burning the TMDB quota. Task 4.2's "All routes: authenticateRequest" sentence is scoped to group routes; nothing equivalent covers Phase 5 routes except "member-only" on session routes. (b) `POST /api/movie-sessions` states caller-membership enforcement only inside the `memberFlags` sentence ("every key MUST be a member of the group and the caller MUST be a member, else 403") — a literal reader can implement the caller check only when `memberFlags` is present, letting any authed user create sessions against any groupId (and pull all members' profiles into a match).

**Fix:** Add a blanket line to Task 5.4: "ALL Phase 5 routes require `authenticateRequest` (401 otherwise); `POST /api/movie-sessions` additionally requires the caller to be a member of `groupId` (404, matching the group-detail non-leak convention) regardless of whether memberFlags is present." Add the non-member-session-create case to the Step 1 test list.

### M5. Task 5.2 — `max_tokens: 4096` with adaptive thinking risks truncation; no `stop_reason` handling specified

**Location:** Task 5.2 Anthropic call (`max_tokens: 4096`) and response parsing.

**Problem:** On Sonnet 5, thinking tokens count against `max_tokens`. A taste map for N members + 5–7 recommendations + conversational prose is easily 1.5–2.5K output tokens; medium-effort thinking on a 200-candidate prompt can consume the remainder, yielding `stop_reason: "max_tokens"` with truncated JSON → misdiagnosed as `malformed` and pointlessly retried at full cost. The plan also never branches on `stop_reason` (`"refusal"` is also a possible, if unlikely, outcome on Sonnet 5).

**Fix:** Raise `max_tokens` (8192–16384 is safe non-streaming), and specify in the parser/call site: `stop_reason === "max_tokens"` → `MatchingError("truncated")` (or fold into `malformed` but log the stop_reason distinctly); check `stop_reason` before parsing. Log `stop_reason` in the structured `matching_call` event.

---

## MINOR findings

1. **Task 1.2 Step 3** — "expect all 13 tables": the verify query will return **14** rows because `rate_limit_log`'s `AUTOINCREMENT` creates `sqlite_sequence`. Fix the expected count or filter `WHERE name NOT LIKE 'sqlite_%'`. (Also worth asking whether `AUTOINCREMENT` is needed at all — plain `INTEGER PRIMARY KEY` suffices for a log table.)
2. **Task 1.4 Step 0** — "node:sqlite requires Node ≥ 22.5" is incomplete: on 22.5–22.x it needs the `--experimental-sqlite` flag, and some versions print an `ExperimentalWarning` to stderr, which violates the pristine-test-output rule (testing-pitfalls §1). Specify: require a Node where `node -e "require('node:sqlite')"` runs clean without flags (≥ 23.4 / current 24.x), and assert no warning noise in the fake-d1 self-test run.
3. **Tasks 5.4 and 7.3 contain "…? NO — …" rhetorical self-corrections** (title-search `inCatalog` enrichment; couch-mode profile overrides). A cold subagent skimming can latch onto the first (rejected) half. Rewrite as plain statements of the decided behavior; delete the rejected alternative or move it to a "Rejected:" note. Related: `inCatalog: false` is mentioned mid-sentence but absent from the final response shape `{tmdbId, title, year, posterPath}` — state explicitly that the response has no `inCatalog` field.
4. **Task 5.4 profile PUT** — "cap 10 unknown ids per request" doesn't say what happens above the cap (400? silently enrich first 10 and store the rest un-enriched? drop them?). Specify (recommend: 400 with a clear error; keeps the invariant that every stored id exists in `titles`).
5. **Rate-limit races** — `checkJoinRateLimit` (count-then-insert) and the monthly cap are bypassable by concurrent requests; testing-pitfalls §5 explicitly flags this exact pattern. For this product the stakes are low — but the plan should say "accepted risk, not tested under concurrency" or add a burst test, so a reviewer applying the checklist doesn't churn on it.
6. **Pristine test output** — `parseMatchingResponse`/`callClaude` log via `console.log` (dropped-id counts, `matching_call` events). Tests exercising those paths will emit noise, violating testing-pitfalls §1 and CLAUDE.md's pristine rule. Specify an injected logger (defaulting to console) or spy-and-assert on console in tests.
7. **Task 7.4** — "8 most-used tags" is uncomputable (no usage data exists in Phase 1). Specify a hardcoded subset of MOOD_TAGS in the plan (e.g. Cozy, Funny, Thrilling, Feel-Good, Intense, Lighthearted, Dark, Romantic) so the subagent doesn't invent an analytics query.
8. **Task 4.2** — group-name validation doesn't reserve `"__solo__"`; a user creating a group literally named `__solo__` gets an invisible group (filtered by M3's exclusion). Reject the reserved name in create validation.
9. **Task 5.3 internal contradiction** — the Files line says "modify `vitest.config.ts` exclude" while Step 1 concludes exclusion "is NOT needed if skipIf works." Remove the Files-line mention or state the decision once.
10. **Task 7.6 ↔ 6.1** — 7.6's "reduce animations" toggle sets a `data-reduced-motion` attribute "consumed by globals.css", but 6.1's globals.css spec only defines the `@media (prefers-reduced-motion)` kill switch. Add the `[data-reduced-motion] ...` selector to 6.1 (or to 7.6's file list as a globals.css modification).
11. **`rough_day` semantics vs. column name** — the flag on member M means "M reported that the *other* member had a rough day; favor the others," which is the opposite of what `session_members.rough_day` naturally reads as. The plan's engine spec (5.2) and mockup agree, but the migration comment and `memberFlags` doc should state the semantics explicitly ("rough_day=1: this member deprioritizes their own preferences tonight") to prevent an inverted implementation in couch mode.
12. **Task 3.2** — "reading `.dev.vars` style env or `TMDB_API_TOKEN` exported": `tsx` does not load `.dev.vars`. Specify the mechanism (a ~5-line parser of `.dev.vars` in seed.ts, or "export the var; seed reads `process.env` only") so the subagent doesn't add a dotenv dependency (which standing rule 6 forbids without a Deviation).
13. **Execution strategy** — running Phase 3 parallel to Phase 2 in worktrees conflicts on shared living documents: both must update the plan's banners and `dev/implementation-log.md`. Note the resolution (e.g. orchestrator applies banner/log updates serially at merge time).

---

## Dimension summary

| Dimension | Verdict |
|---|---|
| 1. Ambiguity | Findings: B2/B3 (unimplementable-as-written flows), M4 (auth scoping readable two ways), minors 3, 4, 7, 11, 12. |
| 2. Context gaps | Findings: B1 (extraction step missing), M2 (contract field missing), minor 10. Otherwise strong — file paths, reference lines, versions, and API shapes are unusually concrete and verified accurate. |
| 3. Interpretation latitude | Largely well-fenced (standing rule 6, explicit DEFERRED markers, "do not invent a different approach"). Residual risk only where specs are unimplementable (B2/B3) forcing improvisation. |
| 4. Cross-task dependencies | Findings: M3 (`__solo__` in the wrong task), M2 (5.4↔7.5), minors 10, 13. Phase ordering and the Task 1.4 hoist are otherwise sound. |
| 5. Testing pitfalls | Findings: minors 2, 5, 6 (pristine output, concurrency checklist). Mock discipline is good: fake-D1 over mocks, fixture-tested transforms, no mock-only OAuth tests, live evals behind a flag. |
| 6. Implementation pitfalls | ORCH-1 satisfied in spirit (subagent-driven strategy + living-document contract; dispatchers should still include persistence paths in prompts). Findings: M4 (auth), M5 (unhandled stop_reason ≈ swallowed error class). SQL injection and prompt-injection surfaces are well covered (bound params, sqlQuote, guardrail + clamps + adversarial gate). |
| 7. Technical correctness | Findings: M1 (Musical/Music), M5 (max_tokens), B1 (content-block structure), minor 1 (table count). Everything else checked out — see "Verified-correct claims." |

**Bottom line:** the plan is unusually well-grounded (nearly every reference-codebase and API claim survived verification), but three specs are unimplementable as written (B1, B2, B3) and would force cold subagents to improvise in exactly the areas — AI call handling, cross-user data exposure, invite-code enumeration — where improvisation is most dangerous. Fix the three blockers and the five majors before dispatch; the minors can be batched into one editing pass.
