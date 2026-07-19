# Adversarial Plan Review — Round 4 (independent cold read)

**Plan reviewed:** `docs/plans/2026-07-18-movie-night-phase1-plan.md` (950 lines, read end-to-end)
**Reviewer stance:** independent; no conversation history; no edits made to the plan.
**Context consulted:** `dev/research/plan-review-round2.md` (fix verification), DESIGN.md (tokens, loading sequence, radii, person colors), `dev/plans/design-doc.md` (§Privacy Principles, quick-match, leave-group semantics), `mockup.jsx` (tag vocabulary, loading phases), `docs/git-strategy.md` (§Output persistence exists at line 199), `docs/pitfalls/testing-pitfalls.md`, `docs/pitfalls/implementation-pitfalls.md`, tee-times `vitest.config.ts` (verified verbatim-copy is viable; node env, no react plugin needed — Vite's default esbuild `jsx: automatic` handles TSX in tests), current Anthropic API reference (claude-api skill), and Cloudflare docs via `search_cloudflare_documentation` (subrequest limits, verified 2026-07-18).

## Round-2 fix verification (all landed coherently)

Every round-2 BLOCKER/MAJOR fix is present and internally consistent, except where noted in findings below:

- **B1** text extraction: Task 5.2 now specifies `content.find(b => b.type === "text")`, stop_reason branching before parse, and the fake client returning a leading thinking block (`{type:"thinking", thinking:"", signature:"x"}`). Verified correct against current API behavior on `claude-sonnet-5` (thinking blocks precede text; `display` defaults to omitted with empty thinking text).
- **B2** cross-member profiles: Task 7.3 locked to "no profile data of other members is fetched or shown" — implementable with existing endpoints. (But see MAJOR-4: the old rejected wording still leads the sentence.)
- **B3** join preview: Task 7.2 now shows code-only confirm, name revealed post-join. Consistent with Task 4.2's minimal join response.
- **M1** `Musical`→`Music` present in `GENRE_TAG_TO_TMDB` with the TMDB-genre-list test.
- **M2** `lastRefreshedAt` added to the 5.4 titles map and consumed by 7.5's staleness badge. Contract closed.
- **M3** `__solo__` exclusion + reserved-name rejection now specified and tested in Task 4.1; 5.4 references it.
- **M4** blanket auth line at the top of Task 5.4 ("Every route in this phase (including /api/titles/search) requires authentication") + unconditional session-create membership check with test. Closed.
- **M5** stop_reason branching specified — but the `max_tokens` value fix only landed in prose, not in the code block (MAJOR-1 below).
- Round-2 minors: table count (13+sqlite_sequence=14) fixed; node:sqlite warning suppression specified with fallback flag; 5.4's rhetorical self-correction cleaned (7.3's was NOT — MAJOR-4); PUT unknown-id cap → 400 specified; rate-limit race documented as ACCEPTED; injected logger specified; quick-match chips hardcoded; `__solo__` name reserved; 5.3 vitest-config contradiction removed; 6.1↔7.6 `[data-reduced-motion]` selector reconciled; rough_day semantics documented in the migration comment; `.dev.vars` parser specified for seed; execution strategy now strictly sequential (worktree conflict concern resolved).

Tag vocabulary in Task 1.1 verified byte-identical to mockup.jsx lines 33–34. Monthly-cap `strftime('%Y-%m-01T00:00:00Z','now')` produces T-separated ISO comparing correctly against `sqliteIsoNow()` values. Invite-code alphabet excludes 0/1/I/L/O/i/l/o as claimed. DESIGN.md defines every token Phase 6 references (`--midnight #0f1219`, `--person-a/-b`, radii 4/8/16/9999, loading-sequence phased text with ≥1.5s minimum).

---

## MAJOR findings

### MAJOR-1. Task 5.2 — code block says `max_tokens: 4096`, prose says "Use `max_tokens: 16000`"

**Location:** Task 5.2, "Anthropic call" code block (line ~759) vs. the "Response handling (CRITICAL)" paragraph (line ~772).

**Problem:** The round-2 M5 fix landed only in the prose. The plan's convention elsewhere is that code blocks are copy-paste-complete; a cold subagent pasting the block ships 4096, which with adaptive thinking counting against the cap reproduces exactly the truncation → misdiagnosed-`malformed` → double-cost-retry failure M5 described. An internal contradiction also invites the executor to "pick one" silently.

**Fix:** Change the code block to `max_tokens: 16000` and delete the trailing sentence "Use `max_tokens: 16000` (thinking counts against the cap)" or keep it as rationale. (16000 is also the correct non-streaming ceiling — the SDK warns/times out on much larger non-streaming requests.)

### MAJOR-2. Task 2.3 — `deleteAccount` violates `UNIQUE(session_id, user_id)` when the second member of a shared session deletes their account

**Location:** Task 2.3 `deleteAccount` snippet: `UPDATE session_members SET user_id = 'deleted' WHERE user_id = ?`; schema Task 1.2: `session_members ... UNIQUE(session_id, user_id)`.

**Problem:** For a couples app, both members of a group eventually deleting their accounts is a mainline flow, not an edge case. First deletion rewrites that user's `session_members` rows to `'deleted'`. Second deletion then attempts a second `('session_id', 'deleted')` row in the same sessions → UNIQUE constraint violation → the batch fails → the second user's account deletion 500s (and since `db.batch` runs transactionally, nothing is deleted). The Step 1 test seeds only ONE user, so TDD as written can go green without ever exercising this.

**Fix:** Use a per-row unique sentinel, e.g. `UPDATE session_members SET user_id = 'deleted-' || lower(hex(randomblob(4))) WHERE user_id = ?` (randomblob is evaluated per row), and have the anonymization check match `user_id LIKE 'deleted%'`. Update the Task 2.3 test to seed TWO users sharing one movie_session and delete both, asserting both succeed. (Alternative: drop the UNIQUE constraint — but it usefully guards session-member inserts; the sentinel fix is smaller.) Serializers/UI that render member names should treat the `deleted` prefix as "Former member" — note it wherever session members are rendered (7.5 taste map uses AI-response names, so exposure is limited to the 5.4 session GET).

### MAJOR-3. Phase 5 ↔ Phase 7 contract gap — matching error responses have no specified HTTP status or body shape

**Location:** Task 5.2 error taxonomy (`MatchingError(kind)`: `malformed`/`timeout`/`overloaded`/`rate_limited`/`thin_results`) vs. Task 5.4 match route (only the 429 cases have specified bodies) vs. Task 7.5 ("Error states per matching error taxonomy: nap message with Retry; rate-limit message; thin-results gets ... copy").

**Problem:** 7.5's UI must branch on the error *kind*, but the locked API contract never says how a `MatchingError` crosses the HTTP boundary — status codes and body shape are unspecified for every kind except the two 429s. Two cold subagents (5.4 executor, 7.5 executor) will invent shapes independently, and the plan's own "API design locked here (UI consumes exactly this)" framing means neither will feel licensed to reconcile.

**Fix:** Add to Task 5.4's locked contract: on engine failure the match route returns JSON `{ error: <user-facing message>, kind: "malformed" | "timeout" | "overloaded" | "rate_limited" | "thin_results" }` with statuses e.g. `malformed` → 502, `timeout`/`overloaded` → 503, `rate_limited` → 429, `thin_results` → 422. Task 7.5 branches on `kind`, never on message text. Add one route test per kind (testing-pitfalls §3: each error branch triggered, message asserted).

### MAJOR-4. Task 7.3 — the rejected couch-mode design still leads the sentence (round-2 minor 3, unfixed for this task)

**Location:** Task 7.3, first bullet: "for OTHER members (couch mode) it edits their profile via the same PUT gated by group membership — Phase 5 API allows editing only own profile, so couch-mode edits for others are kept CLIENT-side and sent as session-scoped `memberFlags`/inline profile overrides? NO — LOCKED DECISION: ..."

**Problem:** Round-2 flagged exactly this "...? NO —" pattern; it was fixed in 5.4 but survives here, in the most privacy-sensitive UI task. The sentence *opens* by asserting behavior ("it edits their profile via the same PUT") that the locked decision then forbids. A subagent skimming (or an LLM latching onto the first imperative clause) can implement the rejected cross-user write path — precisely the failure mode B2 was fixed to prevent. The sentence also has an unbalanced parenthesis, making the true spec harder to parse.

**Fix:** Rewrite as a plain statement of the decided behavior: "Each OTHER member's step shows their name/avatar, a one-line note that their saved profile will be used, and their rough-day toggle (collected into `memberFlags`). No other member's profile data is fetched, shown, or edited — no API for it exists, by design. (Rejected: couch-mode editing of other members' profiles — see PR note.)"

### MAJOR-5. Input clamps miss the title arrays — `comfortTitles`/`watchlist` are unbounded at both the route and prompt layers

**Location:** Task 5.4 profile PUT validation ("arrays; tmdb ids are ints; tags are strings ≤ 30 chars, ≤ 30 tags per list") and Task 5.2 prompt clamps ("member name ≤ 50, custom tag ≤ 30, moodText ≤ 200, steering ≤ 300").

**Problem:** Tags are capped at 30 per list but the tmdb-id arrays have no count cap. A profile with 10,000 watchlist ids is accepted, stored as a megabyte JSON column, and — because the user message "lists each member block" including comfort/watchlist titles — rendered into every matching prompt uncapped (the 200-candidate cap bounds the *candidate* section only, not the member blocks). `selectCandidates` step 2 also loads "every title referenced by any member's comfort/watchlist" before the cap is applied. This is a token-cost/DoS hole in an app whose adversarial-input hardening is a stated launch gate (Phase 8.4), and the 10-unknown-ids-per-PUT cap doesn't bound *known* ids.

**Fix:** Add to the PUT validation: ≤ 50 ids per list (400 above). Mirror defensively in `buildMatchingPrompt` (truncate member title lists to 50) and add it to the Step 1 clamp tests alongside the existing 10k-char string cases.

---

## MINOR findings

1. **Cron subrequest budget assumes Workers Paid — state it.** Task 3.3 makes up to 200 external `fetchMovieDetail` calls per scheduled invocation. Verified against Cloudflare docs (2026-07-18): Workers **Free** allows **50 external subrequests per invocation** (Paid: 10,000 default). On a free-plan account the weekly refresh dies at ~50 fetches with "Too many subrequests," silently degrading staleness data post-launch. Add one line to Task 3.3 or Phase 8.7: "requires Workers Paid (200 external subrequests/run; Free caps at 50) — confirm plan tier at deploy, or drop the batch to ≤40 titles/run on Free."

2. **No specified transform from a TMDB *detail* response to a full `titles` row.** Task 3.1's transforms are `discoverPageToTitles(json, genreMap)` (expects discover-shape `genre_ids`) and `detailToEnrichment(json)` (cast/keywords/streaming only). The Task 5.4 PUT-enrichment path ("fetches it via `fetchMovieDetail` and inserts it") has only a detail response, which carries `genres: [{id, name}]`, not `genre_ids` — neither spec'd transform produces the base row. Add `detailToTitle(json)` to Task 3.1's transform list (fixture-tested like the others) and reference it from 5.4.

3. **`POST /api/movie-sessions` response shape is unspecified.** The 7.3/7.4 flows need the new session id to call `POST .../[id]/match` and navigate to `/results/[sessionId]`, but the locked contract never states what create returns. Specify: `{ id, groupId, createdAt }` (or the session row) — one line.

4. **Solo groups are joinable by invite code.** `createSoloGroup` inserts a group, and `groups.invite_code` is `NOT NULL UNIQUE`, so every `__solo__` group carries a live code that `joinGroup` will honor — a joiner would then be included in the owner's solo sessions (session_members is created for ALL group members) and could read them via the member-only session GET. The code is never displayed and 54^8 is unguessable under the rate limit, so risk is low — but it's a one-line, one-test fix: `joinGroup` treats codes belonging to `__solo__` groups as unknown (404). Add to Task 4.1's test list.

5. **Rough-day toggle: solo and N>2 cases unspecified.** (a) Task 7.4 quick match shows the private rough-day heart, but for "Just me tonight" solo sessions the toggle is semantically void (5.2's weighting collapses "all toggled or none" to equal weight) — specify that the toggle is hidden for solo. (b) The RoughDayToggle copy `«name» had a rough day` interpolates *which* name? Unambiguous for 2-member groups (the partner); undefined for 3+ (the plan supports N members and curated person colors for >2). Specify: partner's name for 2-member groups; generic copy ("Someone had a rough day / Prioritize the others' preferences over mine tonight") otherwise.

6. **Task 7.2 hardcodes `movienight.scarson.io` in the invite link copy button.** The domain doesn't exist until Phase 8.7 (and only if Sam approves deploy). Specify `${window.location.origin}/groups/join/${code}` so the copied link works in local/preview and after the domain lands.

7. **Poster rendering: ban `next/image` for TMDB posters explicitly.** `next.config.ts` is the minimal `{}` (no `images.remotePatterns`) and OpenNext image optimization is unconfigured, so a subagent reaching for `<Image src="https://image.tmdb.org/...">` gets a runtime "hostname not configured" error, discovered late at the Phase 7 visual check. Add to Task 7.1's poster.tsx spec: "plain `<img>` with explicit width/height and `loading="lazy"` — do NOT use `next/image` (no image-optimization config in this stack)."

---

## Dimension summary

| Dimension | Verdict |
|---|---|
| 1. Ambiguity | MAJOR-3 (error contract), MAJOR-4 (surviving rejected-design lead-in), minors 3, 5. |
| 2. Context gaps | MAJOR-1 (contradictory max_tokens), minors 2, 6, 7. Otherwise unusually strong — file paths, line refs, and API shapes verified accurate. |
| 3. Missing do-NOT boundaries | Minor 7 (next/image) is the only substantive one found; standing rule 6 + "do not invent a different approach" otherwise fence well. |
| 4. Cross-task ordering / contract consistency | MAJOR-3 (5.4↔7.5 error kinds), minors 2 (3.1↔5.4 transform), 3 (5.4↔7.3/7.4 create response). Phase ordering, the Task 1.4 hoist, and the sequential execution strategy are sound. All round-2 contract fixes verified landed. |
| 5. Testing pitfalls | MAJOR-2's test seeds one user and cannot catch the UNIQUE violation (testing-pitfalls §4 empty/N-inputs, §3 error-path). Otherwise good: fake-D1 over mocks, injected logger, fixture-tested transforms, live evals gated, ExperimentalWarning suppressed, concurrency races explicitly ACCEPTED. |
| 6. Implementation pitfalls | MAJOR-5 (unbounded arrays vs the adversarial launch gate), minor 4 (solo-group join surface). ORCH-1 satisfied (sequential subagent-driven + living-document contract; this report itself persisted per the rule). |
| 7. Technical correctness | MAJOR-1, MAJOR-2 (SQLite UNIQUE semantics), minor 1 (verified CF subrequest limits), minor 2 (TMDB detail vs discover shape). Anthropic usage verified current: `claude-sonnet-5` valid; `thinking: {type:"adaptive"}` valid (and default-on for Sonnet 5); `output_config.{effort, format.json_schema}` canonical; no `minimum`/`maximum` in schemas confirmed; `refusal`/`max_tokens` stop reasons real; thinking-before-text block order confirmed; `@anthropic-ai/sdk ^0.116.0` current. Migration SQL, monthly-cap strftime, invite alphabet, tag vocabulary, DESIGN.md token names all check out. |

## Bottom line

The plan is very close to execution-ready: every round-2 blocker and major landed, the reference-codebase and API claims survive re-verification, and the cross-task contracts are now mostly airtight. Five MAJORs remain — one literal contradiction (max_tokens), one real correctness bug in a mainline flow (double account deletion), one contract hole the UI depends on (error kinds), one surviving instance of the rejected-design phrasing round 2 already flagged, and one clamp gap that undercuts the stated security launch gate. All are small, localized edits; fix them plus the seven one-line minors in a single editing pass and dispatch.
