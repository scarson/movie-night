# Implementation log

## Task 0.1: Initialize Next.js project skeleton

**Built:** `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`. Extended `.gitignore` with `next-env.d.ts`, `.open-next/`, `.wrangler/`, `.DS_Store`.

**Decisions:**
- `package.json` scripts/deps written verbatim from the plan, except two version pins that had to change to make `npm install` resolve (see Gotchas/Deviations below).
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` copied verbatim from `/Users/sam/Code/twin-cities-tee-times` per plan Steps 2-4.
- `layout.tsx`/`page.tsx` written minimal (no Nav/AuthProvider/LocationProvider — those are tee-times-specific and out of scope for Phase 0) with `// ABOUTME:` headers, per plan Step 5. `globals.css` is a single `@import "tailwindcss";` line.
- `eslint.config.mjs` ignores list extended with `"mockup.jsx"` (not in tee-times' config, since tee-times has no such file) — `mockup.jsx` is functional-spec reference material at repo root, not application code, and was failing `react/no-unescaped-entities` lint checks pre-existing in that file.

**Gotchas / Deviations (see plan's Deviations subsection for the canonical record):**
1. `wrangler@^4.105.0` resolves to `4.112.0` on a fresh install, and wrangler ≥4.108.0 declares a peer dependency on `@cloudflare/workers-types@^5.x`, conflicting with the plan-pinned `@cloudflare/workers-types@^4.20260701.1` (ERESOLVE). Pinned `wrangler` to the exact version tee-times' lockfile uses (`4.105.0`, no caret) to stay in the v4 workers-types family, matching the reference implementation exactly.
2. `@anthropic-ai/sdk@^0.116.0` (as specified in the plan) does not exist on the npm registry — latest published version at execution time was `0.112.3`. Pinned to `^0.112.3`.

**Check results:**
- `npm install`: 735 packages, no errors (after the two pins above). 2 moderate audit advisories reported, not investigated further (transitive, pre-existing upstream, no fix available without `--force`) — out of scope for Phase 0.
- `npx tsc --noEmit`: clean, no output.
- `npm run lint`: clean, no output (after adding `mockup.jsx` to eslint ignores).
- `npm run build`: succeeded — `next build` compiled, static pages generated for `/` and `/_not-found`.

## Task 0.2: Cloudflare config — wrangler.jsonc, open-next.config.ts, worker.ts, env.d.ts, vitest

**Built:** `wrangler.jsonc`, `open-next.config.ts`, `worker.ts`, `src/lib/cron-handler.ts` (stub), `env.d.ts`, `vitest.config.ts`, `vitest-setup.ts`, `.dev.vars.example`. Extended `.gitignore` with `.dev.vars`.

**Decisions:**
- `wrangler.jsonc` observability syntax (`observability.logs.invocation_logs` + `observability.traces.enabled`) verified live against Cloudflare docs via `search_cloudflare_documentation` before writing — confirmed current and correct, matching the plan's pre-verified claim.
- `worker.ts` and `src/lib/cron-handler.ts` written per the plan's exact blocks; `runWeeklyRefresh(env, fetchImpl = fetch)` is a no-op stub (`console.log` + return) so `worker.ts` compiles ahead of real Phase 3 logic. Signature matches the plan exactly so Phase 3 can drop in real logic without touching `worker.ts`.
- `vitest.config.ts` copied from tee-times' shape (globals, node env, `src/**/*.test.{ts,tsx}` include, forks pool, `@` alias, `./vitest-setup.ts` setup) minus tee-times' smoke-test `exclude` entry (we have no smoke config in this project).
- `vitest-setup.ts` is an empty `export {}` stub rather than a copy of tee-times' (which imports `vitest-axe`, a dependency this project deliberately excludes) — the plan's own documented fallback for this case.
- `.dev.vars.example` lists the five secrets named in the plan's "Environment / secrets ground truth" section with inline copy instructions (no README setup section exists to point to).

**Deviations (see plan's Deviations subsection for the canonical record):** `vitest-setup.ts` stub instead of tee-times copy; `.dev.vars.example` self-contained comment instead of a README pointer. Both documented inline in the plan.

**Check results:**
- `npx tsc --noEmit`: clean, no output (worker.ts's `.open-next` imports don't break type-check since it's excluded from tsconfig; `env.d.ts`'s `CloudflareEnv` picked up globally for `cron-handler.ts`).
- `npm run lint`: clean, no output.
- `npm test`: `vitest run --pass-with-no-tests` — "No test files found, exiting with code 0" (expected, no test files yet).

## Task 0.3: CI workflow

**Built:** `.github/workflows/ci.yml`.

**Decisions:**
- Copied tee-times' `ci.yml` verbatim except dropping the `proxy-tests` job (Python/Lambda-specific, no equivalent in this project). Kept the `.serena/**` paths-ignore entry even though this repo has no `.serena/` directory — harmless unused glob, keeps the diff against the reference minimal.
- Ran the build job's exact command locally before committing: `NEXT_TELEMETRY_DISABLED=1 npx @opennextjs/cloudflare build` — succeeded, produced `.open-next/worker.js`, and confirmed `worker.ts`'s two `.open-next` import paths (`./.open-next/cloudflare/init.js`, `./.open-next/server-functions/default/handler.mjs`) resolve to real files post-build. Cleaned up `.open-next/` and `.next/` afterward (both gitignored).

**Check results:**
- `npx @opennextjs/cloudflare build`: succeeded locally, matching the CI `build` job.
- typecheck/lint/test jobs use the same commands already verified clean in Tasks 0.1/0.2.

## Phase 0 group review (standing rule 8)

3 review rounds against the full Phase 0 diff (correctness/conformance, security, misc sanity):

- **Round 1 (correctness/conformance):** found `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `worker.ts` missing `// ABOUTME:` headers — they were copied verbatim from tee-times per the plan's literal instruction, but tee-times itself doesn't header those files, and the explicit task instruction ("every code file starts with the 2-line // ABOUTME: header") is unconditional. Added headers to all four, re-ran `tsc`/`lint`/`test`/`build` — all still clean.
- **Round 2 (security):** grepped all Phase 0 files for secret-shaped strings (API keys, tokens) — none found. Confirmed `.dev.vars.example` has only placeholder values, `.dev.vars` is gitignored, no `.dev.vars` file was ever created, `wrangler.jsonc`'s `database_id` is the documented placeholder, and CI workflow uses least-privilege `permissions: contents: read`.
- **Round 3 (misc):** verified `opennextjs-cloudflare` binary exists in `node_modules/.bin` (used by `preview`/`deploy` scripts); confirmed `.dev.vars.example` is tracked (not accidentally gitignored by the `.env.*` pattern). No further issues.

Clean after Round 1's fix — stopped at 3 rounds per standing rule 8.

## Task 1.1: Tag vocabulary + matching response types

**Built:** `src/config/tags.ts`, `src/types/matching.ts`, `src/types/matching.test.ts`.

**Decisions:**
- `tags.ts` written verbatim from the plan (MOOD_TAGS, GENRE_TAGS, ALL_TAGS) — no test required per plan (Step 1 is data-only).
- `matching.test.ts` written first per TDD: recursively walks `MATCHING_RESPONSE_SCHEMA` asserting every `type: "object"` node has `additionalProperties: false` and a `required` array whose keys exactly match `properties` keys (sorted-set equality, order-independent). Ran red first — `Cannot find module './matching'` — confirming the expected failure mode (module missing), then implemented `matching.ts` verbatim from the plan to go green.
- `matching.ts` types + `MATCHING_RESPONSE_SCHEMA` written verbatim from the plan (member-generic `MemberTaste[]`, not personA/personB). `as const` on the schema literal.

**Gotcha:** the test's local `JsonSchema` type declared `required?: string[]` (mutable), which didn't structurally accept the `as const` schema's `readonly [...]` tuple arrays under `tsc --noEmit` (not caught by vitest itself, which doesn't type-check). Fixed by declaring `required?: readonly string[]` in the test's type and casting the schema via `as unknown as JsonSchema` (a plain `as JsonSchema` was rejected by TS as an insufficient-overlap cast even after the readonly fix, because `properties` values are still deeply readonly literal types).

**Check results:**
- `npx vitest run src/types/matching.test.ts`: red first (module not found), confirmed expected failure; green after implementation (3 tests passed).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 1 file / 3 tests passed.

**Commit:** `c1ce289` — `feat: add tag vocabulary and matching response types/schema`

## Task 1.2: D1 schema migration

**Built:** `migrations/0001_initial_schema.sql`, `src/types/db.ts`.

**Decisions:**
- Migration SQL written verbatim from the plan: 13 tables (10 Phase-1-active + 3 Phase-2 stubs — `watch_history`, `watch_ratings`, `tension_axes` — created empty now to avoid a later migration).
- `src/types/db.ts` scoped to exactly the 10 row interfaces the plan names explicitly (`UserRow`, `AuthSessionRow`, `ProfileRow`, `GroupRow`, `GroupMemberRow`, `MovieSessionRow`, `SessionMemberRow`, `RecommendationRow`, `TitleRow`, `RateLimitRow`) — recorded as a Deviation (see plan) since the step's prose said "every table" but the explicit name list covers only 10; treated the list as authoritative per standing rule 6.

**Check results:**
- `npm run migrate:local`: all 13 CREATE TABLE / CREATE INDEX statements executed successfully against local D1 (Miniflare).
- `npx wrangler d1 execute movie-night-db --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`: 15 rows — `_cf_METADATA`, `group_members`, `groups`, `movie_sessions`, `profiles`, `rate_limit_log`, `recommendations`, `session_members`, `sessions`, `sqlite_sequence`, `tension_axes`, `titles`, `users`, `watch_history`, `watch_ratings`. All 13 schema tables present; `sqlite_sequence` (AUTOINCREMENT bookkeeping) and `_cf_METADATA` (Miniflare's own local-D1 bookkeeping table, not ours) are the two extras — recorded as a Deviation from the plan's predicted 14-row count.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 1 file / 3 tests passed (no new test files this task — schema + types only).

**Commit:** `8505089` — `feat: add D1 initial schema and row types`

## Task 1.3: db utils

**Built:** `src/lib/db.ts`, `src/lib/db.test.ts`.

**Decisions:**
- Test written first per TDD: exact-string assertions on `sqliteIsoNow()`'s output (both no-modifier and `"-7 days"` modifier forms), plus `parseJsonColumn` coverage for valid JSON (array and object), `null`, `undefined`, and two garbage-JSON shapes (`"not json"`, `"{broken"`) per the testing-pitfalls "empty/null/zero inputs" and "error path coverage" checks. Ran red first — `Cannot find module './db'` — confirming expected failure, then implemented to go green.
- `sqliteIsoNow` copied verbatim from `/Users/sam/Code/twin-cities-tee-times/src/lib/db.ts:135-140` (including its doc comment explaining the space-vs-T-separator mismatch between SQLite `datetime()` and JS `toISOString()`). `parseJsonColumn` written verbatim from the plan's code block.

**Check results:**
- `npx vitest run src/lib/db.test.ts`: red first (module not found), confirmed expected failure; green after implementation (6 tests passed).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 2 files / 9 tests passed.

**Commit:** `d3b9cc3` — `feat: add db utils (sqliteIsoNow, parseJsonColumn)`

## Task 1.4: Fake-D1 test helper

**Built:** `src/test/fake-d1.ts`, `src/test/fake-d1.test.ts`. Modified: `package.json` (`test` script wraps `vitest run` with `NODE_OPTIONS=--disable-warning=ExperimentalWarning`).

**Decisions:**
- Step 0 verified: local Node is v26.3.0 (well above the ≥22.5 floor); the `--disable-warning=ExperimentalWarning` flag exists (`node --help` confirms it) and was applied to the `test` script.
- Test written first per TDD: insert+select round-trip, `first()` returning `null` on no match, `all()` wrapping results, `run()`'s `meta.changes`, `DELETE ... RETURNING` (against `sessions`, mirroring the real auth-rotation use case), and FK cascade delete (`users` → `group_members` via `groups`/`group_members`, exercising `PRAGMA foreign_keys = ON`) — all run against the real migration SQL via `loadMigration()`, not a hand-rolled mini-schema. Ran red first — `Cannot find module './fake-d1'` — confirming expected failure, then implemented to go green (7 tests).
- `createFakeD1` wraps `node:sqlite`'s `DatabaseSync`: `.prepare()` returns a `FakeD1PreparedStatement` whose `.bind()`/`.first()`/`.all()`/`.run()`/`.raw()` map onto `DatabaseSync`'s sync `get`/`all`/`run`, wrapped in `Promise.resolve` semantics (all methods are `async`) to match D1's async API shape. `.batch()` wraps statements in `BEGIN`/`COMMIT` with `ROLLBACK` on error. `withSession()`/`dump()` throw "not implemented" — unused by any Phase 1-5 code path per the plan.
- `D1Database`/`D1PreparedStatement` are `declare abstract class` (not `interface`) in `@cloudflare/workers-types` — structurally compatible with a plain object, but `node:sqlite`'s bind-parameter type (`SQLInputValue`) doesn't match D1's `bind(...values: unknown[])`, so the prepared-statement's internal `params` field is typed `SQLInputValue[]` with a cast at the `bind()` boundary (`values as SQLInputValue[]`) rather than casting at every call site.

**Discovery:** on this Node (v26.3.0), `node:sqlite` emits no `ExperimentalWarning` — see the plan's new "Discoveries" subsection. The suppression flag is still correct to keep for CI (Node 24).

**Check results:**
- `npx vitest run src/test/fake-d1.test.ts`: red first (module not found), confirmed expected failure; green after implementation (7 tests passed: round-trip, null-on-miss, all()-wrapping, run()-changes, DELETE...RETURNING, FK cascade, loadMigration-reads-schema).
- `npx tsc --noEmit`: clean (after typing `params` as `SQLInputValue[]` — initial `unknown[]` typing failed against `node:sqlite`'s stricter bind-parameter type).
- `npm run lint`: clean.
- `npm test`: clean, 3 files / 16 tests passed, no warnings in output (verified both with and without the `NODE_OPTIONS` flag — no warning appears either way on this Node version).

**Commit:** `7c26642` — `test: add in-memory D1 fake backed by node:sqlite`

## Phase 1 group review (standing rule 8)

4 review rounds against the full Phase 1 diff (correctness/conformance, security, testing-pitfalls conformance, verify-the-fix):

- **Round 1 (correctness/conformance):** cross-checked every field of every `src/types/db.ts` row interface against its column in `migrations/0001_initial_schema.sql` (type, nullability) — all 10 match exactly, including the `titles` table's several nullable columns (`year`, `poster_path`, `seasons`, `last_refreshed_at`, `updated_at`). Reviewed `src/test/fake-d1.ts` for correctness against the `D1Database`/`D1PreparedStatement` abstract-class shapes in `@cloudflare/workers-types` — structurally compatible via the documented cast. Surfaced one platform claim needing verification rather than assumption (see below); no code defects found.
- **Round 2 (security):** grepped all Phase 1 files for secret-shaped strings — none. Confirmed all SQL in `src/lib/db.ts` and `src/test/fake-d1.ts` uses `?` placeholders with `.bind()`, no interpolation of caller-controlled data — the one exception, `sqliteIsoNow`'s `modifier` template-literal interpolation, is an unchanged copy of the tee-times reference pattern and every current call site (including all in Phase 1) passes a hardcoded literal (`"-7 days"`), never request-derived input. `src/test/fake-d1.ts` is test-only, not imported by any `src/app` route.
- **Round 3 (testing-pitfalls conformance):** walked `docs/pitfalls/testing-pitfalls.md`'s checklist against `db.test.ts`, `matching.test.ts`, `fake-d1.test.ts`. Found one real gap: §4 Negative Property Testing calls for explicit empty-string coverage on every value-accepting parameter, and `parseJsonColumn` had none (only `null`/`undefined`/two garbage-JSON shapes). Added `it("returns the fallback for an empty string", ...)` plus `it("returns valid JSON's falsy/empty values instead of the fallback", ...)` (guards against a `if (!parsed) return fallback` off-by-truthiness bug pattern — empty array and `0` must round-trip, not fall through to the fallback). Also verified, via `search_cloudflare_documentation` + WebFetch on `developers.cloudflare.com/d1/sql-api/foreign-keys/`, that **D1 enforces foreign key constraints by default** (quote: "identical to the behaviour you would observe when setting `PRAGMA foreign_keys = on` in SQLite for every transaction") — confirms the schema's `ON DELETE CASCADE` chains will actually fire in production D1, matching `fake-d1.ts`'s explicit pragma. Recorded in the plan's Discoveries section for Phase 2.
- **Round 4 (verify the fix):** reran full suite after the Round 3 test additions — 18/18 passing (up from 16), `tsc`/`lint` still clean, no new gaps found on a second pass over the same three test files against the same checklist.

No implementation defects were found across any round — all four rounds' findings were either verified-correct platform assumptions or test-coverage strengthening. Stopped at 4 rounds (round 3 found a real gap, so per standing rule 8 a round 4 was required to confirm clean).

**Final Phase 1 gate results:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` — 3 files / 18 tests passing, pristine output (no warnings, with or without the `NODE_OPTIONS` suppression flag on this Node version).

**D1 local table list** (`npx wrangler d1 execute movie-night-db --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`): `_cf_METADATA`, `group_members`, `groups`, `movie_sessions`, `profiles`, `rate_limit_log`, `recommendations`, `session_members`, `sessions`, `sqlite_sequence`, `tension_axes`, `titles`, `users`, `watch_history`, `watch_ratings` — all 13 schema tables present; `sqlite_sequence` (AUTOINCREMENT) and `_cf_METADATA` (Miniflare's own bookkeeping) are expected extras.

**Phase 1 commits:** `c1ce289` (tag vocab + matching types), `4dd4f98` (docs sync), `8505089` (D1 schema + row types), `d3b9cc3` (db utils), `7c26642` (fake-D1 helper), `1388d1f` (review-driven test strengthening).

## Task 2.1: src/lib/auth.ts

**Built:** `src/lib/auth.ts`, `src/lib/auth.test.ts`.

**Decisions:**
- `src/lib/auth.ts` ported verbatim from `/Users/sam/Code/twin-cities-tee-times/src/lib/auth.ts`, changing ONLY `COOKIE_SESSION = "mn-session"`, `COOKIE_REFRESH = "mn-refresh"`, and the ABOUTME wording, per the plan's explicit instruction. Both encoded gotchas preserved unchanged: `DELETE FROM sessions ... RETURNING` for atomic refresh-token claim (prevents double-rotation races), and the 15m JWT / 90d refresh token lifetimes.
- `src/lib/auth.test.ts` ported from tee-times' `src/lib/auth.test.ts` wholesale (per plan Step 1: "If tee-times has `src/lib/auth.test.ts`, port those tests wholesale first"), with two adaptations beyond the cookie-name swap:
  1. Cookie names `tct-session`/`tct-refresh` → `mn-session`/`mn-refresh` throughout.
  2. Replaced tee-times' jest-style `createMockD1()` (mock `mockFirst`/`mockRun` call sequencing) with this project's `createFakeD1(loadMigration())` helper from Task 1.4 — real SQLite via `node:sqlite`, seeded through small `seedUser`/`seedSession` test helpers. This is stronger than the reference: the rotation test now asserts actual DB state (old session row gone, exactly one new row for the user) instead of asserting a mock was called, and the "race condition" test simplifies to "no session row exists for that refresh-token hash" (DELETE...RETURNING naturally returns null for both never-existed and already-claimed-by-a-concurrent-request cases — they're indistinguishable, which is the correct real-world semantics).
  3. Added a known-vector `sha256("abc")` test (plan Step 1's explicit requirement) alongside the existing determinism test.
- The reference's "user was deleted" branch (session row found, but the joined `users` row is missing) is unreachable in the fake-D1 test given the schema's `sessions.user_id REFERENCES users(id) ON DELETE CASCADE` — deleting a user always cascades its sessions in the same statement, so a session can never outlive its user. tee-times' own suite didn't test this branch either (it's defensive dead code under FK enforcement). Not added as a test; noted here rather than silently skipped.
- Ran red first: `Cannot find module '/src/lib/auth'` on all 24 tests, confirming expected failure before implementing.

**Check results:**
- `npx vitest run src/lib/auth.test.ts`: red first (module not found, 24/24 failing as expected); green after implementation (24/24 passed).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 4 files / 42 tests passed.

**Commit:** `d911d9c` — `feat: port auth utilities with mn- cookie prefix`

## Task 2.2: OAuth routes

**Built:** `src/app/api/auth/google/route.ts`, `src/app/api/auth/google/callback/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`.

**Decisions:**
- All four routes ported verbatim from `/Users/sam/Code/twin-cities-tee-times/src/app/api/auth/...`, changing only the items the plan names:
  - Cookie names throughout: `tct-oauth-state`→`mn-oauth-state`, `tct-oauth-verifier`→`mn-oauth-verifier`, `tct-session`→`mn-session`, `tct-refresh`→`mn-refresh`.
  - Callback route: decodes `claims.picture` from Google's ID token (`avatarUrl = typeof claims.picture === "string" ? claims.picture : null`) and upserts it. The users `INSERT ... ON CONFLICT(google_id) DO UPDATE` now includes `avatar_url` and `updated_at` in both the insert column list and the `DO UPDATE SET` clause (`avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`) — existing users' avatar/name/email/updated_at refresh on every re-login; `created_at` is untouched by the conflict branch.
  - `/api/auth/me`: query and response extended to include `avatar_url`/`avatarUrl` alongside `userId`/`email`/`name`.
- Both encoded gotchas preserved unchanged: `response.cookies.set()` (not raw `headers.append`) on every redirect response in `google/route.ts` and `google/callback/route.ts` — OpenNext on Cloudflare Workers silently strips `Set-Cookie` headers attached via `headers.append` to a redirect; and the `MAX_SESSIONS = 10` excess-session cleanup in the callback (deletes oldest sessions beyond 10 per user, not just one).
- No unit tests written for these routes per the plan's explicit instruction ("Route-handler logic is exercised end-to-end in Phase 8 manual verification... per testing rules we do NOT write mock-only tests for it") — OAuth cannot be meaningfully unit-tested without mocking Google's token exchange, and CLAUDE.md bans mocks in end-to-end tests while these aren't meaningfully unit-testable either. Verified instead with `npx tsc --noEmit`, `npm run lint`, and `npm run build` (confirms all four routes register as dynamic API routes in the Next.js route manifest).

**Check results:**
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 4 files / 42 tests passed (unchanged from Task 2.1 — no new test files this task).
- `npm run build`: succeeded; route manifest confirms `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/logout`, `/api/auth/me` all registered as dynamic (ƒ) routes.

## Task 2.3: Account deletion (anonymize, never cascade shared history)

**Built:** `src/lib/account.ts`, `src/lib/account.test.ts`, `src/app/api/user/account/route.ts`.

**Decisions:**
- `deleteAccount(db, userId)` implemented exactly as the plan's code block specifies: a `db.batch` of three statements — anonymize `session_members.user_id` with a per-row random sentinel (`'deleted-' || lower(hex(randomblob(4)))`), set `movie_sessions.initiated_by_user_id` to the fixed string `'deleted'`, then `DELETE FROM users WHERE id = ?`. The users delete cascades `sessions`/`profiles`/`group_members` via existing FK `ON DELETE CASCADE` (verified against real D1 FK enforcement in the Phase 1 group review).
- The fixed-vs-random sentinel distinction matters and is directly tested: `session_members` has `UNIQUE(session_id, user_id)`, so a fixed `'deleted'` string for every deleter in the same session would violate that constraint on the second deletion. `movie_sessions.initiated_by_user_id` has no such uniqueness constraint (a session has exactly one initiator), so the fixed sentinel is correct there and cheaper to serialize.
- `src/lib/account.test.ts` written first per TDD (red confirmed: `Cannot find module './account'`), covering: (1) users row deletion cascades sessions/profile/group_members; (2) `session_members` row survives with a `deleted-[0-9a-f]{8}` sentinel, not deleted; (3) `movie_sessions.initiated_by_user_id` becomes the fixed `'deleted'` string; (4) another member's `group_members`/`session_members`/`users` rows are untouched; (5) **the mandatory two-members-of-the-same-session case** — both members of `sess1` delete their accounts sequentially, asserted to not throw, to leave exactly 2 `session_members` rows, each matching the sentinel pattern, and to produce two *distinct* sentinel values (the actual bug a fixed sentinel would cause).
- `DELETE /api/user/account` route ported from tee-times' shape (`authenticateRequest` → mutate → `clearAuthCookies` → JSON) but swapped tee-times' raw `DELETE FROM users` for `deleteAccount()`; response body is `{ ok: true }` (the plan's locked API — tee-times additionally returns `clearLocalStorage: true`, which movie-night's plan doesn't specify, so it's omitted rather than invented).

**Check results:**
- `npx vitest run src/lib/account.test.ts`: red first (module not found); green after implementation (5/5 passed), including the two-members-same-session test.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 5 files / 47 tests passed.
- `npm run build`: succeeded; route manifest confirms `/api/user/account` registered as a dynamic (ƒ) route.

**Commit:** `3083516` — `feat: add account deletion with shared-record anonymization`

## Phase 2 group review (standing rule 8, mandatory security perspective)

3 review rounds against the full Phase 2 diff (`git diff a1b44db..HEAD`: `src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/lib/account.ts`, `src/lib/account.test.ts`, and the 5 route files):

- **Round 1 (correctness/conformance):** Diffed every ported file line-by-line against its `/Users/sam/Code/twin-cities-tee-times` source, confirming the only deltas are the ones each task lists: cookie name prefix (`tct-` → `mn-`) throughout `auth.ts` and all four OAuth routes; the callback's `avatar_url` upsert extension (column added to both the INSERT list and the `DO UPDATE SET` clause, bound correctly in bind-parameter order); `/api/auth/me`'s response extended with `avatarUrl`; and `account/route.ts` swapping tee-times' raw `DELETE FROM users` for `deleteAccount()`, dropping tee-times' extra `clearLocalStorage: true` field (not in this project's locked response shape `{ ok: true }`). No unintended drift found.
- **Round 2 (security — mandatory):**
  - **State validation:** the OAuth CSRF state is a `crypto.randomUUID()` round-tripped through an `HttpOnly` cookie (`mn-oauth-state`) and compared against the `state` query param on callback (`stateParam !== expectedState`); a mismatch or missing cookie hard-fails to an error redirect before any token exchange happens. Unchanged from the reference.
  - **Open redirects:** `validateReturnTo` (tested with 7 cases including `//evil.com`, `http://evil.com`, backslash payloads, null, empty) is applied at every point `returnTo` is derived from client input — both the initial cookie parse and the state-match branch — so no code path can hand an unvalidated `returnTo` to `NextResponse.redirect`.
  - **Cookie flags:** every `Set-Cookie` across all 5 routes and `auth.ts`'s cookie helpers carries `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` conditionally on `request.url.startsWith("https://")` — verified by grep across the full diff, no cookie set without the shared `cookieOptions()`/`baseCookieOpts` helper.
  - **Session rotation:** `DELETE ... RETURNING` (auth.ts:113) atomically claims the refresh session before issuing a new one, preventing concurrent double-rotation; directly tested (`auth.test.ts`: rotation test asserts the old session row is actually gone and exactly one new row exists; race-condition test asserts no session row + no cookie-clear when the claim finds nothing). `MAX_SESSIONS = 10` bounds unbounded session-row growth per user on repeated logins.
  - **D1 batch atomicity (new verification, not in the plan's pre-verified list):** confirmed via `search_cloudflare_documentation` that D1's `batch()` executes as a real SQL transaction — "If a statement in the sequence fails, ... it aborts or rolls back the entire sequence." This confirms `deleteAccount`'s three-statement batch (anonymize session_members → anonymize movie_sessions → delete user) can't partially apply in production, matching `fake-d1.ts`'s BEGIN/COMMIT/ROLLBACK emulation. Recorded as a Discovery in the plan for future D1-batch-writing tasks (Phase 4+).
  - No findings requiring a code change. Considered and ruled out as non-issues (all inherited unmodified from the already-reviewed tee-times reference, not introduced by this port): non-constant-time state-string comparison (state is a high-entropy single-use UUID, not a comparison-timing-sensitive secret); unverified `decodeJwt` of Google's ID token (token comes from a direct server-to-server HTTPS exchange with Google via `arctic`, not a client-supplied value, so signature verification is redundant — the accepted pattern for authorization-code flow); CSRF on `DELETE /api/user/account` (mitigated by `SameSite=Lax` blocking cross-site non-navigation requests, same as every other authenticated route).
- **Round 3 (misc / testing-pitfalls conformance):** grepped the full diff for secret-shaped strings (none), confirmed every new file has an ABOUTME header, confirmed no `dangerouslySetInnerHTML` introduced. Walked `docs/pitfalls/testing-pitfalls.md` against `auth.test.ts`/`account.test.ts`: §3 error-path coverage — all `authenticateRequest` branches covered (valid JWT, rotation, expired-refresh-in-D1, no-refresh-cookie, no-session-cookie, malformed-JWT, race/already-claimed); §4 negative property testing — `validateReturnTo`'s null/empty/backslash/protocol-relative cases covered, `deleteAccount`'s two-same-session-members case is exactly the concurrency-flavored identity-collision scenario §5 calls for (tested as sequential calls rather than true concurrent racing, since `deleteAccount` has no check-then-act step for the sentinel — each call's `randomblob(4))` is independently generated, so sequential and concurrent calls are equivalent here); §7 no network calls in any Phase 2 unit test — confirmed, `callClaude`-style network code doesn't exist yet and OAuth routes are deliberately unit-test-free per the plan. One known reference-inherited gap, not a Phase 2 regression: the `authenticateRequest` "user was deleted mid-session" branch is unreachable under FK-cascade enforcement (see Task 2.1 log entry) and untested in both tee-times and here — defensive dead code, not worth a contrived test that would have to bypass the FK constraint to exercise it.

No implementation defects found across any round. Stopped at 3 rounds per standing rule 8 (no round found an issue requiring a 4th confirmation pass).

**Final Phase 2 gate results:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` — 5 files / 47 tests passing; `npm run build` succeeded (7 API routes registered as dynamic).

**Phase 2 commits:** `d911d9c` (auth utilities), `ccee89b` (docs sync), `b22b51e` (OAuth routes), `e4a726f` (docs sync), `3083516` (account deletion).

## Task 3.1: TMDB client

**Built:** `src/lib/tmdb.ts`, `src/lib/tmdb.test.ts`, `src/test/fixtures/tmdb-discover-page.json`, `src/test/fixtures/tmdb-movie-detail.json`, `src/test/fixtures/tmdb-search.json`.

**Fixture provenance (per the plan's documented fallback):** no `.dev.vars` exists in this worktree (confirmed via `ls`), so no real TMDB token was available to capture live responses. WebFetch against `developer.themoviedb.org/reference/{discover-movie,movie-details,movie-search,movie-keywords,movie-credits,movie-watch-providers,genre-movie-list}` returned only the parameter/schema shell for each page — the interactive "Try It" response examples require a live session and aren't present in the static HTML. Fixtures were instead transcribed from TMDB API v3's stable, versioned response contract using real, well-known movie ids/titles (Inception `27205`, The Dark Knight `155`) so field names, nesting, and value shapes are honest rather than invented. This is recorded inline in `tmdb.test.ts`'s header comment as well as here.

**Decisions:**
- Test written first per TDD (`src/lib/tmdb.test.ts`): ran red — `Cannot find module './tmdb'` — before implementing. 15 tests covering: `discoverPageToTitles` (field mapping, empty `release_date`/null `poster_path` → null, genre_ids with no map entry silently dropped), `detailToTitle` (genres from the embedded `genres:[{id,name}]` array, not `genre_ids`; defensive genre-map fallback when a name is empty/missing), `detailToEnrichment` (top-8 cast by `order` — including an out-of-order input to prove the sort, not just a lucky pre-sorted fixture; keyword name strings; US streaming subset; empty-object fallback when the US entry or the whole `credits`/`keywords`/`watch/providers` block is absent), `searchResultsToSummaries`, and the four fetch wrappers' URL/header construction against an injected `fetch` stub (asserts *our* request construction, not TMDB's behavior) plus a 401→`TmdbError` case.
- API design decision (plan specifies function signatures but not how they compose): `discoverPageToTitles` + `detailToEnrichment` is the pairing the seed script (Task 3.2) will use — discover pages are cheap and give base fields (title/year/genres/synopsis/poster/votes/popularity) for many titles per request, then one detail fetch per title supplies only the cast/keywords/streaming enrichment. `detailToTitle` builds a *complete* `TitleFields` from a detail response alone with no discover call — reserved for Task 5.4's PUT-enrichment path (profile references a `tmdbId` not yet in `titles`, fetched directly by id, no discover step involved). This composition isn't spelled out in the plan; recording it here so Task 3.2/5.4 executors don't have to re-derive it.
- `detailToTitle(json, genreMap)` — the plan requires the `genreMap` parameter even though detail responses embed `{id, name}` genre objects. Made it a genuine defensive fallback (`genre.name || genreMap[genre.id]`) rather than an unused parameter, tested explicitly (a genres entry with an empty/undefined name still resolves via the map). Avoids an unused-parameter lint smell while keeping the plan's exact signature.
- `tmdbGet<T>(path, params, token, fetchImpl)` is the single thin wrapper all four network functions route through: builds `https://api.themoviedb.org/3${path}` via `URL`/`searchParams` (correct percent-encoding for the literal `watch/providers` value in `append_to_response`), sets `Authorization: Bearer ${token}` + `accept: application/json`, throws `TmdbError` (has a `.status` field) on non-ok responses. Seed script's "abort on 401" (Task 3.2) can check `err.status === 401`.
- No `posterUrl()` helper added — poster URL construction (`https://image.tmdb.org/t/p/w342...`) belongs to the UI layer (Task 7.1's Poster component) per the schema comment that `titles.poster_path` stores only the TMDB path fragment; adding it here would be scope creep per standing rule 6.

**Check results:**
- `npx vitest run src/lib/tmdb.test.ts`: red first (module not found, confirmed); green after implementation (15/15 passed).
- `npx tsc --noEmit`: one error on first pass (`credits.cast` slice typed as `{order:number}[]` didn't structurally satisfy `TmdbCastMember[]` in the "shuffled input" test) — fixed by importing and casting through `TmdbCastMember` directly instead of an inline structural type. Clean after.
- `npm run lint`: clean.
- `npm test`: clean, 6 files / 62 tests passed.

**Commit:** `fe524c1` — `feat: add TMDB client with fixture-tested transforms`

## Task 3.2: Seed script

**Built:** `scripts/seed-lib.ts`, `scripts/seed-lib.test.ts`, `scripts/seed.ts`. Modified: `.gitignore` (added `scripts/seed.sql`), `vitest.config.ts` (include glob extended to `scripts/**/*.test.ts`).

**Decisions:**
- `titleToInsertStatement(title: SeedTitle, now: string)` extracted into `scripts/seed-lib.ts` per the plan, test-first (red confirmed: `Cannot find module './seed-lib'`). `now` is an injected parameter (not `Date.now()` inside the function) so the function stays pure and its output is exact-string-assertable.
- **Data-integrity hardening (anticipating the Phase 3 group review's mandatory data-integrity perspective):** all numeric title fields (`tmdb_id`, `year`, `vote_count`, `vote_average`, `popularity`) are coerced through `Number()`/`Math.trunc()` with a `Number.isFinite` guard before being interpolated into SQL text, falling back to `0` on anything non-finite — not just quoted strings. TMDB is an external, only-nominally-trusted response source; without this, a malformed or hostile `popularity` field (e.g. a string) would have been interpolated raw into the statement, opening a second-order SQL injection path even though string/JSON columns go through `sqlQuote`. Directly tested: a hostile `popularity: "1); DROP TABLE titles;--"` value coerces to `0` and the statement contains no `DROP TABLE`; a `NaN` `voteCount` coerces to `0`; a non-integer `tmdbId` truncates.
- `sqlQuote` (single-quote doubling) is the only escaping primitive; all JSON columns (`genres`, `top_cast`, `keywords`, `streaming`) are `JSON.stringify`'d THEN passed through `sqlQuote` — tested that a quote embedded inside a JSON array element (e.g. a cast member name `"Ke Huy Quan's Cameo"`) is still correctly doubled after serialization, not double-encoded or left raw.
- `seasons` is hardcoded to a bare `NULL` for every row — this seed script only calls `/discover/movie` and `/movie/{id}`, never touches TV; a `content_type: 'tv'` path doesn't exist yet (out of scope per standing rule 6).
- `parseDevVars` (KEY=VALUE parser for `.dev.vars`, since `tsx` doesn't load it automatically unlike Wrangler) was also placed in `seed-lib.ts` and unit-tested even though the plan only explicitly mandates testing `titleToInsertStatement` — it's equally pure and cheap to verify (comments/blank lines, quoted values, missing `=`, values containing embedded `=`, empty content).
- `scripts/seed.ts` (the orchestrator — CLI arg parsing, token resolution via env then `.dev.vars` fallback, throttled discover+detail fetch loop, SQL file write, optional `wrangler d1 execute` shell-out) is intentionally NOT unit tested, matching the plan's scope (only the extracted pure function is test-mandated) and the OAuth-routes precedent from Task 2.2 (Node-context orchestration with real file/process/network side effects isn't meaningfully unit-testable without mock-heavy tests CLAUDE.md prohibits). Verified instead by smoke-running it under `tsx` (see Check results) to catch import/syntax errors, plus `tsc`/`lint`.
- Seed composition decision (this task, building on the Task 3.1 log's composition note): for each unique `tmdbId` seen across the requested discover pages (deduped via a `Map`, since pagination could theoretically resurface an id if popularity ordering shifts mid-run), the base `TitleFields` come from `discoverPageToTitles`; a subsequent throttled `fetchMovieDetail` supplies only the `detailToEnrichment` subset (cast/keywords/streaming), merged with `{ ...base, ...enrichment }`. A per-title detail-fetch failure logs a warning and seeds the row with base fields only (empty cast/keywords/streaming) rather than aborting the whole run — the one exception is a 401, which aborts immediately via `abortOn401` (checked at the genre-map, per-discover-page, and per-detail-fetch call sites) since a bad token will 401 on every subsequent call and there's no point burning further requests.
- Progress log every 25 titles processed, per the plan. Throttle is a flat 50ms `sleep` between every discover-page and every detail fetch (plan says "throttled" without specifying discover-page throttle timing beyond the overall "≤20 req/s" ground rule; 50ms between requests keeps steady-state well under that even without the detail-fetch concurrency this script deliberately avoids — sequential, not batched, so there's no burst risk).
- `scripts/seed.sql` added to `.gitignore` (generated output, regenerated by `npm run seed:local`).

**Step 4 (live seed run) — BLOCKED, as anticipated by the plan:** confirmed via `ls .dev.vars` that no `.dev.vars` file exists in this worktree and `TMDB_API_TOKEN` is not set in the environment. Per the plan's explicit fallback ("If no token, note it in the implementation log — Phase 8 blocks on a real seed"), the live `npm run seed:local -- --pages 2` run and its `SELECT COUNT(*) FROM titles >= 30` verification were skipped, not faked. **Phase 8 blocks on running a real seed** once Sam supplies a TMDB token.

**Check results:**
- `npx vitest run scripts/seed-lib.test.ts`: red first (module not found, confirmed); green after implementation (17/17 passed).
- `npx tsc --noEmit`: clean (both after `seed-lib.ts` and again after adding `seed.ts`).
- `npm run lint`: clean.
- `npm test`: clean, 7 files / 79 tests passed.
- Smoke test: `npx tsx scripts/seed.ts --pages 1` — ran to the token-resolution check, printed the clear "TMDB_API_TOKEN not found..." message, exited 1. Confirms all imports (including the relative `../src/lib/tmdb` import, chosen over the `@/` alias because `tsx` isn't guaranteed to honor `tsconfig.json` path aliases at runtime) resolve correctly under `tsx`, not just under `tsc`.

**Commit:** `bc867a9` — `feat: add TMDB seed script`

## Task 3.3: Weekly streaming-refresh cron

**Built:** `src/lib/cron-handler.test.ts`. Modified: `src/lib/cron-handler.ts` (replaced the Phase 0 no-op stub with the real implementation).

**Decisions:**
- Test written first per TDD against the real Phase 0 stub (not a missing module, since the file/signature already existed from Task 0.2): 7 tests, all red against the stub (each failed on assertions — the stub does nothing — confirming the expected failure mode) before implementing.
- **Signature deviation from the locked 2-arg stub, done deliberately per the dispatching instruction:** added a third optional parameter `log: (line: string) => void = console.log`, matching the injected-logger pattern the plan establishes for the matching engine (Task 5.2: "via an injected log parameter... keeps test output pristine AND asserts log shape"). This is additive-only — `worker.ts`'s existing single-argument call site (`runWeeklyRefresh(env)`) still compiles and behaves identically (defaults to `console.log`), so the Task 0.2 stub's contract ("Phase 3 keeps that exact signature") is honored for every existing caller; only the *optional* tail was extended. Without this, the structured summary log line test would have needed a `vi.spyOn(console, "log")`, which is exactly the pattern testing-pitfalls §1 (test output pristine) discourages when a cleaner injection point is available and already precedented in this codebase.
- Query for the refresh candidate set: `SELECT tmdb_id, content_type FROM titles WHERE last_refreshed_at IS NULL OR last_refreshed_at < ${sqliteIsoNow("-7 days")} ORDER BY popularity DESC LIMIT 200`. `sqliteIsoNow`'s modifier is interpolated directly into the SQL text (not bound) — this exact pattern was reviewed and confirmed safe in the Phase 1 group review because the modifier is always a hardcoded string literal, never request-derived; `"-7 days"` here is likewise a hardcoded literal.
- `STALE_TITLES_LIMIT = 200` is a module constant, not read from `env` — the plan's Free-vs-Paid-plan note ("~200 TMDB fetches per run requires the Workers Paid plan's 1000-subrequest limit... if the account is Free at deploy time, set LIMIT 40") describes a deploy-time fact not knowable during Phase 3 implementation. Left at 200 with a comment pointing here; **Phase 8 must confirm the Cloudflare account's plan tier before deploying the cron trigger and lower this constant to 40 if it's Free** — otherwise the cron invocation will hit the subrequest limit and fail mid-run on every execution.
- Both `tmdb_id` AND `content_type` are selected and used in the `UPDATE ... WHERE` clause, even though the seed script (Task 3.2) only ever inserts `content_type = 'movie'` rows today — `titles`' primary key is the composite `(tmdb_id, content_type)`, and matching on `tmdb_id` alone would silently update the wrong row (or both) once TV rows exist. Cheap correctness now avoids a real bug later when TV support lands.
- Update scope is exactly what the plan specifies — `streaming`, `popularity`, `vote_count`, `vote_average`, `last_refreshed_at` — deliberately NOT `title`/`genres`/`synopsis`/`poster_path`/`top_cast`/`keywords`. A weekly refresh's job is "is this still streaming where we said, and is it still as popular/well-rated as we thought," not a full re-seed; re-touching cast/keywords on every refresh would also be 10x the TMDB payload for no benefit this task needs.
- Continues past per-title failures: each `fetchMovieDetail` + `detailToEnrichment` call is wrapped in its own `try/catch`; a failure increments `errors` and the loop moves on — no statement is queued for that title, so its `last_refreshed_at` stays stale (and it'll be picked up again next week, or sooner if it's still in the top-200 by popularity). Tested with a 500 response for one of two titles: the failing title's `last_refreshed_at` remains `NULL`, the succeeding title's is updated, and the summary line reports `{refreshed: 1, errors: 1}`.
- `db.batch` chunking: pending `UPDATE` statements accumulate in an array and flush via `db.batch()` once they reach 25, with a final flush after the loop for any remainder. Tested by seeding 30 stale titles (all succeeding) and asserting `db.batch` (spied via `vi.spyOn`) is called exactly twice, with chunk sizes 25 and 5 — proves the chunking boundary, not just "batch was called."
- The 200-cap itself is tested by seeding 205 stale titles (via a single bulk `INSERT ... VALUES (...),(...),...` through the fake D1's `exec()` for speed, not 205 round-tripped `.run()` calls) and asserting the fetch stub was called exactly 200 times — a real boundary test per testing-pitfalls §4 (oversized inputs / bounded growth), not just "it doesn't crash with a lot of rows."

**Check results:**
- `npx vitest run src/lib/cron-handler.test.ts`: red first against the Phase 0 stub (7/7 failing on assertions, confirming the stub is a no-op); green after implementation (7/7 passed).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 8 files / 86 tests passed.

**Commit:** `bfd3065` — `feat: implement weekly TMDB streaming refresh cron`

## Phase 3 group review (standing rule 8, mandatory data-integrity perspective)

4 review rounds against the full Phase 3 diff (`git diff 9080ac6..HEAD` — `src/lib/tmdb.ts`, `src/lib/tmdb.test.ts`, `src/lib/cron-handler.ts`, `src/lib/cron-handler.test.ts`, `scripts/seed.ts`, `scripts/seed-lib.ts`, `scripts/seed-lib.test.ts`, the three TMDB fixtures, `.gitignore`, `vitest.config.ts`):

- **Round 1 (correctness/conformance):** re-read every file end to end. One real gap found: `scripts/seed.ts` would silently write an empty `scripts/seed.sql` (zero `INSERT` statements) and, under `--local`/`--remote`, proceed to shell out to `wrangler d1 execute` on that empty file — a "successful" no-op run — if every discover-page fetch failed for a non-401 reason (e.g. a transient outage), since the per-page failure path only warns and continues. Fixed: after the discover loop, if `titlesById.size === 0`, abort with a clear message and exit 1 before any file write or wrangler shell-out. Everything else checked out: `tmdbGet`'s URL/header construction, the discover/detail/enrichment transform pure functions, `detailToTitle`'s genre-map fallback, `detailToEnrichment`'s top-8-by-`order` sort (non-mutating `[...cast].sort()`), the cron query's stale-title predicate and composite `(tmdb_id, content_type)` WHERE clause on the UPDATE (correctly matches the schema's actual primary key rather than assuming `tmdb_id` alone is unique), and the `db.batch` chunking/flush closure semantics.
- **Round 2 (security):** grepped the full Phase 3 diff for secret-shaped strings (API keys/tokens ≥20 chars) — none found; all token values in tests/fixtures are short placeholder strings (`test-token-123`, etc). Confirmed the TMDB bearer token never appears in a URL (only in the `Authorization` header inside `tmdbGet`), so it can't leak via logged error messages (`TmdbError.message` only ever includes `status` + `path`, never headers). Confirmed `scripts/seed.ts`'s `spawnSync("npx", wranglerArgs, ...)` uses an argv array (not shell string concatenation) with only hardcoded, non-user-derived arguments — no command-injection surface. `cron-handler.ts`'s `UPDATE` statement is fully parameterized via `.bind()` (no string interpolation of any TMDB-derived value), which is strictly safer than `seed-lib.ts`'s raw-SQL-text approach — the latter is dictated by `wrangler d1 execute --file=`'s raw-SQL-file interface (no bind-parameter channel across that CLI boundary), not a design choice we could avoid; noted, not a finding.
- **Round 3 (mandatory data-integrity perspective — SQL escaping in seed-lib, JSON serialization):** the existing `seed-lib.test.ts` coverage only asserted the *shape* of the generated SQL text (string-contains checks), never that it was actually valid, executable SQL. Added a new `describe` block that runs `titleToInsertStatement`'s output through the real `node:sqlite`-backed fake D1 (`db.exec(sql)` then `SELECT ... WHERE tmdb_id = ?`) and asserts an exact round-trip for: a title containing single quotes + a literal backslash + an embedded newline; unicode/emoji in title and synopsis (七人の侍 🎬✨ / 🗡️); an empty-string synopsis (proving it isn't coerced to `NULL`); and a genre value containing a `'); DROP TABLE titles; --`-shaped payload, asserting both that `titles` still exists afterward AND that the value round-trips as inert JSON text, not executed SQL. **Found a bug while writing this block:** the first draft of the injection test did `const stillExists = db.prepare(...).first();` without `await`-ing the promise, then asserted `expect(stillExists).not.toBeNull()` — a `Promise` object is never `null`, so that assertion was vacuously true regardless of whether the table actually existed (a "testing the mock" pattern CLAUDE.md explicitly bans, caught before it shipped). Fixed by awaiting the query. This is exactly the kind of self-defeating assertion the data-integrity review pass exists to catch — logged here as a caution for future round-trip tests in this codebase: an un-awaited D1 promise assertion always passes.
- **Round 4 (verify the fix):** reran the full gate after Round 1 and Round 3's fixes — `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 8 files / 90 tests passing (up from 86 before the review), and manually re-ran the `npx tsx scripts/seed.ts --pages 1` smoke test to confirm the new zero-titles guard didn't disturb the pre-existing no-token abort path (still aborts cleanly at token resolution, exit 1, before reaching the new guard).

**Final Phase 3 gate results:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` — 8 files / 90 tests passing, pristine output.

**Phase 3 commits:** `fe524c1` (TMDB client), `b925c81` (docs sync), `bc867a9` (seed script), `d863fc6` (docs sync), `bfd3065` (cron), `e3344a3` (docs sync), `fe38cfe` (group review fixes).

**Notes for Phase 4:**
- `src/lib/tmdb.ts` exports `discoverPageToTitles`/`detailToTitle`/`detailToEnrichment`/`searchResultsToSummaries`/`fetchGenreMap`/`fetchDiscoverPage`/`fetchMovieDetail`/`searchMovies`/`TmdbError`, plus the `TitleFields`/`TitleEnrichment`/`SearchSummary`/`GenreMap`/`StreamingInfo` types — Task 5.4's title-search route and PUT-enrichment path will want `searchMovies` + `searchResultsToSummaries` + `detailToTitle`.
- **Phase 8 blocker (real seed):** no TMDB token is available in this worktree. Phase 8 must supply one, run `npm run seed:local -- --pages 25`, and verify `SELECT COUNT(*) FROM titles` before any live matching-engine work can be meaningfully tested end-to-end.
- **Phase 8 deploy-time decision:** `STALE_TITLES_LIMIT` in `src/lib/cron-handler.ts` is hardcoded to 200 (Workers Paid plan assumption, 1000 subrequests/invocation). Confirm the Cloudflare account's actual plan tier before enabling the cron trigger in production — drop the constant to 40 if it's on the Free plan (50 subrequests/invocation), or the cron will fail mid-run on every execution.
- The `titles` table's composite primary key `(tmdb_id, content_type)` is honored correctly by the cron's UPDATE (`WHERE tmdb_id = ? AND content_type = ?`) even though only `'movie'` rows exist today — any future TV-support work should keep matching both columns everywhere, not just `tmdb_id`.

## Task 4.1: Group lib + invite codes

**Built:** `src/lib/groups.ts`, `src/lib/groups.test.ts`.

**Decisions:**
- Test written first per TDD (red confirmed: `Cannot find module './groups'`, 0 tests collected); implemented to go green (16/16 passed).
- Invite codes: `nanoid`'s `customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz", 8)` per the plan's exact code block — excludes `0`, `1`, `O`, `I`, `l` (ambiguous glyphs). Every character this alphabet can produce is a subset of the route-layer format regex `/^[2-9A-Za-z]{8}$/` (verified by inspection: digits 2-9, no ambiguous letters), so Task 4.2's pre-DB format check never rejects a real invite code.
- `createGroup`/`joinGroup`/`getGroupsForUser`/`leaveGroup`/`checkJoinRateLimit`/`logJoinAttempt` implemented exactly per the plan's Task 4.1 Step 1 test list. `createGroup` uses `db.batch` (group insert + creator's group_members insert) for atomicity — matches the Phase 2 review's verified D1 `batch()` transaction guarantee, so a crash between the two inserts can't leave an orphaned group with no members.
- **Scope decision, not explicit in Task 4.1's text:** group-name length/trim/empty validation (`≤ 50 chars, trim, reject empty`) is listed under Task 4.2 ("Input limits") in the plan, not under Task 4.1's lib test list — so `createGroup` does NOT validate name length/emptiness; it only rejects the reserved `"__solo__"` name (the one check Task 4.1's text explicitly assigns to the lib: "lib throws"). Name trimming/length enforcement is implemented at the Task 4.2 route layer instead, keeping the task split literal rather than guessing a different division of labor. Documented here so Task 4.2's reviewer doesn't miss that this validation still needs to exist, just one layer up.
- `joinGroup` excludes `"__solo__"`-named groups from the invite-code lookup itself (`WHERE invite_code = ? AND name != ?`), not via a post-lookup filter — a solo group's code is therefore genuinely indistinguishable from an unknown code to every caller, including in the DB query plan (no separate "found a solo group, discard it" branch that could leak timing/existence information).
- `joinGroup` uses `INSERT OR IGNORE` against `UNIQUE(group_id, user_id)` for idempotency — rejoining an already-joined group is a no-op, not an error.
- `leaveGroup` is a single `DELETE FROM group_members WHERE group_id = ? AND user_id = ?` — no existence/membership check beforehand (idempotent, doesn't throw if the user was never a member). `session_members` rows reference `user_id` directly (not `group_members`), so leaving a group cannot cascade or otherwise disturb session history — verified with a test that leaves a group and asserts the group's `movie_sessions`/`session_members` rows are untouched.
- `checkJoinRateLimit`/`logJoinAttempt`: scope hardcoded to `'group_join'`, key is caller-supplied (Task 4.2 passes the authenticated user's id). The 10-minute window is interpolated via `sqliteIsoNow("-10 minutes")` directly into SQL text (not bound) — the modifier is a hardcoded string literal, never request-derived, matching the pattern the Phase 1/3 reviews already verified as safe for this exact helper. `checkJoinRateLimit` returns `true` when the request should be ALLOWED (count < 10) and `false` when it should be BLOCKED (count >= 10) — chosen so the 11th attempt within a 10-minute window (after 10 prior successful passes, each having called `logJoinAttempt`) is the first one blocked, matching the plan's "≥ 10 attempts... limited" wording exactly. Tested the window boundary explicitly (attempts older than 10 minutes don't count) and scope/key isolation (a different scope or a different key's attempts don't count toward this key's limit).

**Check results:**
- `npx vitest run src/lib/groups.test.ts`: red first (module not found, 0 tests collected, confirmed); green after implementation (16/16 passed).
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 9 files / 106 tests passed.

**Commit:** `dccf8e4` — `feat: add group creation/join/leave with rate-limited invite codes`

