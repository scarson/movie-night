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

## Task 4.2: Group API routes

**Built:** `src/app/api/groups/route.ts` (GET list mine, POST create), `src/app/api/groups/route.test.ts`, `src/app/api/groups/join/route.ts`, `src/app/api/groups/join/route.test.ts`, `src/app/api/groups/[id]/route.ts` (GET detail), `src/app/api/groups/[id]/route.test.ts`, `src/app/api/groups/[id]/leave/route.ts`, `src/app/api/groups/[id]/leave/route.test.ts`. Modified: `src/lib/groups.ts` (added `getGroupDetailForMember`).

**Decisions:**
- **Deviation from the plan's literal "Files" list (route tests added, not omitted):** the plan's Task 4.2 "Files" line lists only the four `route.ts` files, and Step 3 reads "Route-level tests: extract any nontrivial validation into `src/lib/groups.ts` (already tested); routes stay thin. Type-check + lint." — read narrowly, this could mean "no new `route.test.ts` files," matching the Task 2.2 OAuth-routes precedent (explicitly untested because OAuth cannot be tested without mocking Google). Diverged from that narrow reading: unlike OAuth, these routes have zero un-testable external dependencies — auth is a real JWT cookie via `createJWT`, and D1 is the real fake-D1 backed by `node:sqlite`. Only `getCloudflareContext` (the Cloudflare platform accessor) needs mocking, which is legitimate per testing-pitfalls §7 ("mock only external boundaries"). Given CLAUDE.md's unconditional TDD mandate and that nothing here required mocking business logic (no `vi.mock("@/lib/auth")`, no D1 method mocking), wrote real route-level tests: 4 files, 22 tests, covering auth gating (401), the full validation/error taxonomy (400/404/429), and the anti-enumeration/PII-minimization properties the plan calls out as security-relevant. This is additive coverage beyond the plan's literal file list, not a scope change to the routes' behavior — read Step 3's "routes stay thin" as being about where VALIDATION LOGIC lives (in the lib), not as a prohibition on route tests.
- **Reserved-name / name-length validation split (documented in the Task 4.1 entry above):** `POST /api/groups` trims the name and rejects it (400) if empty after trimming or over 50 chars — this validation lives in the ROUTE, matching the plan's Task 4.2 Step 2 ("Input limits" is listed under 4.2, not 4.1). `createGroup`'s reserved-`"__solo__"`-name rejection (a `ReservedGroupNameError` throw) is caught by the route and mapped to 400. Tested both boundary values (50 chars accepted, 51 rejected) and the whitespace-only-name case (trims to empty, rejected).
- **`checkJoinRateLimit` runs before `logJoinAttempt`, and both run before the code-format-valid group lookup:** order in `join/route.ts` is (1) 401 gate, (2) code-format regex — 400, zero DB access, (3) `checkJoinRateLimit` — 429 if already at/over the 10-attempt/10-minute limit, (4) `logJoinAttempt` (counts THIS attempt for future requests), (5) `joinGroup` lookup — 404 if unknown. Step 4 runs even when the code turns out to be unknown at step 5 — deliberately, so that invite-code enumeration (repeatedly guessing well-formatted codes) is what actually gets rate-limited, not just successful joins. Tested explicitly: a single unknown-code attempt leaves exactly one row in `rate_limit_log`.
- **`getGroupDetailForMember` added to `src/lib/groups.ts`** (not explicitly named in Task 4.1's function list, but Task 4.2 Step 3 directs "extract any nontrivial validation into `src/lib/groups.ts`") — combines the membership check and the group+members fetch into a single lib function that returns `null` uniformly for "group doesn't exist" AND "requester isn't a member," so `GET /api/groups/[id]` can 404 both cases identically without a route-level branch that could leak existence via a different status/message. Also excludes `"__solo__"` groups from detail lookups for the same reason `getGroupsForUser` does (internal implementation detail, never surfaced by design) — a one-line addition (`AND name != ?`) beyond what the plan's text explicitly asked for for this endpoint, added for defense-in-depth consistency with every other group-listing path; noted here rather than silently added. Tested that a non-member's 404 body is byte-identical to a nonexistent-group-id's 404 body.
- **`[id]/leave/route.ts`** is a thin wrapper over `leaveGroup` (already idempotent per Task 4.1) — no membership pre-check, matching the tee-times `favorites/[courseId]` DELETE precedent ("idempotent, returns ok even when the row didn't exist"). Tested.
- Next 16 dynamic route handlers take `{ params }: { params: Promise<{ id: string }> }` (confirmed against `/Users/sam/Code/twin-cities-tee-times/src/app/api/courses/[id]/route.ts` and `.../user/favorites/[courseId]/route.ts` — both `await params` before destructuring).
- Every route repeats the `NextResponse.json(...)` + `headers.forEach((value, key) => response.headers.append(key, value))` pattern inline per response branch, matching the codebase's existing convention in `me/route.ts` and `account/route.ts` rather than introducing a new shared response-building helper (no such helper exists yet anywhere in the codebase; adding one would be a cross-cutting refactor out of this task's scope).
- **TypeScript gotcha (test files only):** `@cloudflare/workers-types`' `Response.json<T>()` is generic with no default (`json<T>(): Promise<T>`), so an un-annotated `await response.json()` in a test infers `T = unknown` and blocks property access — fixed with an explicit `response.json<Record<string, any>>()` at each call site that reads response properties (calls used only in `toEqual(...)` didn't need this, since `unknown` satisfies `toEqual`'s parameter type). Separately, declaring an intermediate `const init: RequestInit = {...}` before `new NextRequest(url, init)` fails to type-check under the CF-typed globals (`RequestInit<CfProperties<unknown>>` vs. Next's own `RequestInit` import don't structurally unify through a named variable) — fixed by inlining the object literal directly as the constructor argument instead of naming it, which lets contextual typing resolve it correctly.

**Check results:**
- `npx vitest run "src/app/api/groups"`: red first (4/4 files failed — `Cannot find module './route'` — confirmed, 22/22 tests failing as expected); green after implementation (22/22 passed).
- `npx tsc --noEmit`: two rounds of errors from the `.json()`/`RequestInit` typing gotchas above, both fixed; clean after.
- `npm run lint`: clean.
- `npm test`: clean, 13 files / 128 tests passed.

**Commit:** `6c2e09d` — `feat: add group API routes`

## Phase 4 group review (standing rule 8, mandatory abuse perspective: invite-code enumeration, PII leakage pre-join, rate-limit bypass)

4 review rounds against the full Phase 4 diff (`git diff 0b5cfbd..HEAD` — `src/lib/groups.ts`, `src/lib/groups.test.ts`, the 4 route files + their tests):

- **Round 1 (correctness/conformance):** re-read `groups.ts` and every route end to end against the plan's Task 4.1/4.2 spec line by line. Confirmed: invite-code alphabet (`23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz`) is a strict subset of the route's format regex `/^[2-9A-Za-z]{8}$/`, so no real invite code can ever fail the pre-DB format check. Confirmed `createGroup`'s `db.batch` (group + creator's group_members insert) is atomic per the Phase 2 review's verified D1 transaction guarantee. Confirmed all 5 route handlers gate on `authenticateRequest` before any other logic (401 first, always). Confirmed Next 16's dynamic route param shape (`{ params }: { params: Promise<{ id: string }> }`, `await params`) matches the tee-times reference exactly in both `[id]` route files. No implementation defects found.
- **Round 2 (abuse perspective — mandatory, all three named categories):**
  - **PII leakage pre-join:** `POST /api/groups/join`'s success response is `{ id, name }` only — directly tested (`Object.keys(body).sort()` asserts exactly `["id", "name"]`, no member array). Every OTHER response shape that includes member PII (`GET /api/groups`, `GET /api/groups/[id]`, the `group` object returned by `POST /api/groups`) is only reachable for groups the requester is ALREADY a member of — `getGroupsForUser`/`getGroupDetailForMember` both filter by membership before returning anything. No code path returns another member's data to a non-member. Confirmed clean.
  - **Invite-code enumeration:** the regex-gated 8-char alphabet from `23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz` gives ~58^8 ≈ 1.28 × 10^14 possible codes. The join endpoint is authentication-gated (no anonymous probing) and rate-limited per authenticated user id at 10 attempts/10 minutes, with EVERY well-formatted-code attempt logged (via `logJoinAttempt`) regardless of whether it matches a real group — confirmed by a dedicated test (`"logs a join attempt on a well-formatted code even when the code is unknown"`) — so enumeration attempts count toward the same limit as successful joins, not just the reverse. Confirmed clean.
  - **Rate-limit bypass:** identified a real TOCTOU race in `join/route.ts`'s composition of `checkJoinRateLimit` (SELECT) then `logJoinAttempt` (INSERT) as two separate D1 round-trips — classic count-then-insert race per testing-pitfalls.md §5. **Investigated whether to fix it** (three options considered: reordering to log-before-check — rejected, it silently shifts the effective limit down by one attempt, breaking the tested `checkJoinRateLimit` contract of "false when ≥10 attempts ALREADY logged"; a single atomic `INSERT ... SELECT ... WHERE (subquery count) < 10` statement — technically correct and race-free, but adds a third rate-limit function beyond the plan's two explicitly-named ones for a risk that turns out to be unexploitable in practice, see below; leave as-is and document — chosen). **Attempted to write a concurrency test to exercise the race** (testing-pitfalls §5's explicit guidance: "test it concurrently... Promise.all alone doesn't guarantee simultaneity") and discovered empirically that this project's fake-D1 (`node:sqlite`'s `DatabaseSync`, fully synchronous under the hood) cannot reproduce the race at all — 5 concurrent `Promise.all`-fired requests against a 9-already-logged boundary consistently resolved to exactly 1×200 + 4×429 with a final logged count of 10, because there's no real network round-trip for two "concurrent" requests' SELECT and INSERT to interleave across. The race is real only in production (genuine per-request D1 network latency), not reproducible in this test harness without artificially injecting delays — which would be disproportionate machinery for this specific risk. **Decision: accept, do not fix, matching the plan's own precedent for the identical race class in Task 5.4** (`POST /api/movie-sessions/[id]/match`'s round-limit: "the race is ACCEPTED per eng review — blast radius is one extra $0.04 call — do not add locking"). Unlike the round-limit case, this race's blast radius isn't naturally bounded to "one extra" — an attacker firing many concurrent requests in one burst could in theory get more than 10 attempts through per 10-minute window — but even a generously-abused race (say, 1,000 "free" guesses per burst, repeated every 10 minutes, forever) is still on the order of 10^8 guesses/year against a 1.28×10^14-code keyspace: roughly a million years to exhaust. The rate limiter here is defense-in-depth against casual brute-forcing; the keyspace size is the actual primary defense, and it's unaffected by this race. Given the fix is unverifiable in this project's test infrastructure and the residual risk is not meaningfully different in practice from the already-accepted precedent, fixing it would be exactly the kind of disproportionate engineering CLAUDE.md's linter-suppression bar warns against applying elsewhere ("the fix would be disproportionate to the actual risk in context"). Documented here per the mandatory abuse-perspective review rather than silently passed over.
- **Round 3 (testing-pitfalls conformance):** walked `docs/pitfalls/testing-pitfalls.md`'s checklist against all 5 test files. §3 error-path coverage: found a real gap — `POST /api/groups` and `POST /api/groups/join` both catch `request.json()` parse failures and return 400, but neither had a test triggering that branch. Added `"returns 400 for a malformed JSON body"` to both (`src/app/api/groups/route.test.ts`, `src/app/api/groups/join/route.test.ts`), closing the gap. §5 concurrency: covered by Round 2's investigation above (tested, found untestable-in-harness, documented as accepted). §4 negative property testing: boundary values covered (49/50/51-char group names — wait, tested 50 exactly and 51; the 49 case isn't a boundary and wasn't added, not needed), empty/whitespace-only name, missing name field, malformed code format, unknown code, solo-group code. §7 test infrastructure hygiene: no shared mutable state between tests (each test creates its own `createFakeD1(loadMigration())`), no network calls (only `getCloudflareContext` mocked, an external platform boundary — auth and D1 are real), test doubles are minimal (no `vi.mock("@/lib/auth")` or D1-method mocking, unlike the tee-times reference's `createMockD1` pattern that CLAUDE.md would flag as "testing the mock"). No further gaps found.
- **Round 4 (verify the fix):** reran the full gate after Round 3's additions — `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 13 files / 130 tests passing (up from 128), `npx @opennextjs/cloudflare build` succeeded with all 5 group routes registered as dynamic (ƒ) in the route manifest (`/api/groups`, `/api/groups/[id]`, `/api/groups/[id]/leave`, `/api/groups/join`, alongside the existing Phase 2/3 routes). No new gaps found on the re-pass.

No implementation defects were found requiring a code fix — Round 2's rate-limit race was investigated thoroughly (including an empirical attempt to reproduce it) and explicitly accepted with documented rationale, consistent with the plan's own precedent for the same race class. Round 3's error-path gap was closed with new tests, not a production code change. Stopped at 4 rounds (Round 3 found a real gap, so per standing rule 8 a Round 4 was required to confirm clean).

**Final Phase 4 gate results:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` — 13 files / 130 tests passing, pristine output; `npx @opennextjs/cloudflare build` succeeded (5 group routes + existing Phase 2/3 routes all registered).

**Phase 4 commits:** `dccf8e4` (group lib), `8419769` (docs sync), `6c2e09d` (group API routes), `1fc6e9a` (docs sync), `100d98d` (group review: malformed-JSON-body test coverage).

**Notes for Phase 5:**
- `src/lib/groups.ts` exports `createGroup`, `joinGroup`, `getGroupsForUser`, `getGroupDetailForMember`, `leaveGroup`, `checkJoinRateLimit`, `logJoinAttempt`, `SOLO_GROUP_NAME`, `ReservedGroupNameError`, plus the `Group`/`GroupMember`/`GroupWithMembers` types. Task 5.4's `createSoloGroup(db, userId)` must insert directly into `groups`/`group_members` (NOT call `createGroup`, which rejects `SOLO_GROUP_NAME`) — this was already anticipated and called out in the plan itself.
- The check-then-log rate-limit race pattern documented in Round 2 above will recur for Task 5.4's monthly-match-cap and round-limit checks (both are the same SELECT-count-then-act shape). The plan's Task 5.4 text already independently pre-accepts the round-limit race with the same reasoning ("blast radius is one extra $0.04 call — do not add locking"); Phase 5's executor doesn't need to re-litigate this, just be aware the same class of decision was already made twice with consistent reasoning.
- `getGroupsForUser` fetches each group's members with a separate query per group (N+1 pattern), not a single joined query — acceptable at Phase 1 scale (a handful of groups per user at most) and not flagged as a defect; worth a second look only if a future phase needs this endpoint to scale to many groups per user.


## Task 5.2: Matching engine core

**Built:** `src/lib/matching.ts`, `src/lib/matching.test.ts`, `src/config/tags.test.ts`. Modified: `src/config/tags.ts` (added `GENRE_TAG_TO_TMDB`).

**Decisions:**
- Tests written first per TDD: ran red (`Cannot find module './matching'` for the engine suite; `GENRE_TAG_TO_TMDB` undefined for the tags suite — 4 collected failures), then implemented to green (49/49 across both files).
- **SDK check (per the dispatching instruction):** the installed `@anthropic-ai/sdk@0.112.3` already types everything the plan's call block needs — `OutputConfig` (`effort: 'low'|'medium'|...`, `format?: JSONOutputFormat` with `{ type: 'json_schema', schema }`), `ThinkingConfigAdaptive` (`{ type: 'adaptive' }`), and `StopReason` including `'refusal'`. No SDK upgrade was needed; no Deviation.
- `callClaude` returns `{ text: string | null, stopReason, inputTokens, outputTokens }` rather than throwing on bad stop_reasons — `text: null` signals max_tokens/refusal/missing-text-block, and `runMatching` converts that to `MatchingError("malformed")`. This split exists so the structured `matching_call` log line can still report real token usage for refused/truncated turns (the plan requires a log line "after every call"); transport-level failures (`APIConnectionError` → `timeout`, 429 → `rate_limited`, 529/5xx → `overloaded`) throw from `callClaude` directly and produce no log line since there is no usage to report. Error-instance check order matters and is commented: `APIConnectionError extends APIError` with `status: undefined`, so it must be tested first.
- `runMatching` retries exactly once, only on `kind === "malformed"` (covers bad stop_reason, missing text block, JSON parse failure, shape-guard failure). `thin_results` and all transport kinds do not retry — verified by call-count assertions on the injected fake client.
- The injected fake client returns a **leading thinking block** before the text block in every fixture (plan requirement), so the `content.find(b => b.type === "text")` extraction path is genuinely exercised — a `content[0].text` implementation fails these tests.
- **Plan-gap resolution in `selectCandidates` (Deviation recorded in the plan):** the plan's step 5 ("Cap at 200, ordered by popularity") taken literally would evict low-popularity member-referenced titles whenever the pool exceeds 200, defeating step 2's entire purpose (and the plan's own required "comfort-title inclusion" test, which seeds 250 popular titles + an obscure comfort title). Resolved minimally: member-referenced titles always survive the cap; the cap evicts only popularity-pool titles; the final list is still popularity-ordered and ≤ 200.
- `selectCandidates` filters `content_type = 'movie'` in both queries — only movie rows exist in Phase 1, but the composite PK `(tmdb_id, content_type)` means a future TV row sharing a tmdb_id would otherwise corrupt the pool (same reasoning as the Task 3.3 cron UPDATE).
- Rough-day weight note contract (tested): exactly-one-favored names ONLY the favored member with the 65/35 split and an explicit "never mention or speculate about the reason" instruction; all-toggled/none-toggled → the equal-weight note; multi-favored (3+ members) → a generic note naming nobody. The strings "rough day" never appear anywhere in either prompt.
- Prompt-layer clamps (name 50, tag 30 chars + 30 entries, moodText 200, steering 300, title lists 50 entries) all tested with 10k-char strings and 200-entry arrays; the clamped prefix must appear and the unclamped string must not.
- `parseMatchingResponse` returns `{ response, droppedIds }` so `runMatching` can put the dropped-id list in the log line ("silent filter, count logged" per the plan) without a second validation pass.

**Check results:**
- `npx vitest run src/lib/matching.test.ts src/config/tags.test.ts`: red first (module/export missing), green after implementation (49/49) — one intermediate failure drove the cap/comfort-inclusion design fix above.
- `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npm test`: clean, 15 files / 179 tests passed.

**Commit:** `dabe57e` — `feat: add matching engine (candidates, prompt builder, parser, error taxonomy)`

## Task 5.3: Live eval suite

**Built:** `src/lib/matching.eval.test.ts` (no vitest config change — the `describe.skipIf` guard is sufficient; the file matches the existing `src/**/*.test.ts` include glob).

**Decisions:**
- Two live cases behind `describe.skipIf(!process.env.RUN_LIVE_EVALS)`: (1) round 1 with a fixed 30-candidate list (well-known films with their real TMDB ids, including 3 Horror and 2 War entries that must never surface) and two synthetic profiles (Iris: cerebral-thriller fan, Horror dealbreaker; Theo: cozy-romcom fan, War dealbreaker) — asserts 5–7 recs, all tmdbIds ∈ candidates, no Horror/War genre in any rec, 2 non-empty member summaries, conversational mentions both names; (2) a refinement round asserting a kept title (Inception) stays in the results and a removed title (The Dark Knight) never returns. Quality-seam assertions only, no exact-output assertions. 120s per-test timeout for real API latency.
- A permanently-running guard test (`guards live evals behind RUN_LIVE_EVALS=1`) documents the skip per testing-pitfalls §2 (no unexplained skips) — default runs report 1 passed + 2 skipped for this file.
- API key resolution: `process.env.ANTHROPIC_API_KEY`, falling back to parsing `.dev.vars` via the existing `parseDevVars` from `scripts/seed-lib` (same pattern as the seed script); a clear error if neither exists when the flag is set.
- **Step 2 (live run) — BLOCKED, as anticipated by the plan:** no `.dev.vars` exists in this worktree and `ANTHROPIC_API_KEY` is not in the environment, so the live evals were NOT run (verified they skip cleanly instead: 1 passed + 2 skipped, zero network). **Phase 8 runs them** via `RUN_LIVE_EVALS=1 npm test -- src/lib/matching.eval.test.ts` once a real key is available.
- The dealbreaker assertions here exercise the PROMPT-level enforcement path deliberately: candidates are passed directly (bypassing `selectCandidates`' SQL filter), so Horror/War titles are present in the model's candidate list and only the prompt's dealbreaker instructions keep them out.

**Check results:**
- `npx vitest run src/lib/matching.eval.test.ts` (no flag): 1 passed, 2 skipped — guard verified, no network.
- `npx tsc --noEmit`: clean. `npm run lint`: clean.
- `npm test`: clean, 16 files / 180 passed + 2 skipped.

**Commit:** `bd18e30` — `test: add live matching eval suite behind RUN_LIVE_EVALS`

## Task 5.4: Profile + session + matching API routes

**Built:** `src/lib/movie-sessions.ts`, `src/lib/movie-sessions.test.ts`, `src/app/api/user/profile/route.ts` (+test), `src/app/api/titles/search/route.ts` (+test), `src/app/api/movie-sessions/route.ts` (+test), `src/app/api/movie-sessions/[id]/route.ts` (+test), `src/app/api/movie-sessions/[id]/match/route.ts` (+test).

**Decisions:**
- Strict TDD in two waves: lib tests red first (`Cannot find module './movie-sessions'`, 0 collected) → lib green (22/22); then all 5 route test files red (44/44 failing on missing `./route`) → routes green (44/44). Route tests follow the Phase 4 precedent (real JWT auth + real fake-D1; only platform/network boundaries mocked).
- `createSoloGroup` inserts directly into `groups`/`group_members` (never calls `createGroup`, which rejects the reserved name — per plan). Solo invite codes are `solo-<uuid>` strings that can never match the 8-char join format regex, so a solo group is unjoinable at the join route's format gate in addition to `joinGroup`'s name exclusion. Tested.
- `createMovieSession` verifies caller membership **unconditionally** (tested with no memberFlags present → NotGroupMemberError → route 403) and requires every `memberFlags` key to be a group member. Flag precedence: `memberFlags[caller]` wins over top-level `roughDay`; other members default to off. Session + all member rows inserted in one `db.batch` (atomicity verified in the Phase 2 review).
- **Anthropic mocking strategy for the match route tests:** `vi.mock("@anthropic-ai/sdk")` with `importOriginal`, overriding ONLY the default export (the client class) — `APIError`/`APIConnectionError` stay real so `callClaude`'s `instanceof` mapping is exercised for real. The entire engine path (prompt build, thinking-block extraction, parse, retry, log line, persistence) runs unmocked. Gotcha discovered: the mock implementation MUST be a `function` expression, not an arrow — `new Anthropic(...)` on an arrow-implemented `vi.fn()` throws "not a constructor" (surfaced as a 500 in the first red-green cycle; commented in the test helper).
- Rough-day privacy: `getSessionForMember` returns only the REQUESTING member's flag (`SessionView.roughDay`); `getSessionMembersWithProfiles` (which carries all flags) is prompt-building-only and never serialized. Mandatory tests: the GET body contains exactly ONE `roughDay` occurrence (the requester's own) and never `rough_day`; the match response contains neither.
- Deleted-account members (`user_id` = `deleted-…` sentinel with no users row) drop out of `getSessionMembersWithProfiles` via the inner JOIN on users — they can't contribute preferences; tested.
- Title search strips `%`/`_` BEFORE the 2-char length floor, so `"%%"`/`"%a%"` collapse below the floor instead of LIKE-matching the whole catalog; tested both. TMDB merge fires only under 3 local hits, dedupes by tmdbId (local wins), caps at 10, and a TMDB outage degrades to local-only (error captured + asserted per pitfalls §1).
- Profile PUT enrichment: unknown-id existence checks run BEFORE any TMDB fetch; >10 unknown → 400 `{ error, unknownIds }` with zero fetches (asserted); any fetch failure → 400 `{ error, failedIds }` and the profile row is NOT saved (asserted). Successful enrichment inserts via `INSERT OR REPLACE` with `last_refreshed_at = now` (fresh watch-provider data ⇒ cron skips it for 7 days).
- Match route caps in order: round > 10 → 429 `{ kind: "round_limit" }` with the locked message; monthly count ≥ `MONTHLY_MATCH_LIMIT` (env, default 2000) → 429 `{ kind: "monthly_cap" }`. Both are plain SELECT-then-act — the TOCTOU race is pre-ACCEPTED by the plan/eng review (third occurrence of this documented decision; see the Phase 4 review entry). Both short-circuit before any model call (asserted via the create stub).
- Error taxonomy → HTTP contract locked in `MATCHING_ERROR_HTTP` (match route): malformed/thin_results → 502, timeout/overloaded → 503, rate_limited → 429, all bodies `{ error, kind }`. Exact messages tested. Failed rounds persist NO recommendations row (tested), so a failed call doesn't consume a round.
- `GET /api/movie-sessions/[id]` response is `{ session: SessionView, round, response, titles }` with `round: 0` + `response: null` + `titles: {}` for a fresh session — the reload contract for Phase 7's results page. `titles` map values are `{ title, year, posterPath, genres, streaming, lastRefreshedAt }` (lastRefreshedAt feeds Task 7.5's staleness badge; tested).

**Check results:**
- Lib: red first, then 22/22. Routes: red first (44/44 failing), then 44/44.
- `npx tsc --noEmit`: two tuple-typing errors in test fetch stubs (un-parameterized `vi.fn()` gives `calls: []`), fixed by typing the stub's parameter; clean after.
- `npm run lint`: clean. `npm test`: 21 files / 246 passed + 2 skipped, pristine output.
- `npx @opennextjs/cloudflare build`: succeeded; route manifest registers `/api/movie-sessions`, `/api/movie-sessions/[id]`, `/api/movie-sessions/[id]/match`, `/api/titles/search`, `/api/user/profile` as dynamic (ƒ).

**Commit:** `f9fe41e` — `feat: add profile, title search, and matching session APIs`

## Phase 5 group review (standing rule 8, mandatory SECURITY perspective)

4 review rounds against the full Phase 5 diff (`git diff 0999918..HEAD` — 19 files, ~4,300 insertions: `src/config/tags.ts`(+test), `src/lib/matching.ts`(+test), `src/lib/matching.eval.test.ts`, `src/lib/movie-sessions.ts`(+test), the 5 route files + their tests, plan/log docs):

- **Round 1 (correctness/conformance):** re-read every production file end to end against the plan's Task 5.2/5.3/5.4 text. Verified: the locked Anthropic call parameters (model/max_tokens/thinking/output_config) are asserted field-by-field in a unit test; `content.find(b => b.type === "text")` extraction is forced by leading-thinking-block fixtures everywhere (unit + route tests); stop_reason branches precede parsing; retry is exactly once and only for `malformed`; the structured log line's field set matches the plan's lock exactly (closed `toEqual` assertion — no extra fields can creep in); `formatTitleRefs` renders the plan's "by TITLE with tmdbId" format; the error-taxonomy → HTTP table matches the plan verbatim; the GET/match response shapes match the locked API design. Test-output pristineness verified: full-suite run emits zero stray stdout/stderr (every intentional console.log/console.error in exercised branches is spied and asserted). No defects found; the one design divergence (candidate cap vs. comfort inclusion) was already resolved and recorded as a Deviation during Task 5.2.
- **Round 2 (security — mandatory, all named categories):**
  - **Prompt-injection guardrail:** present verbatim in every system prompt (solo and group), asserted by exact-string test. User-controlled text reaches the prompt only through clamped channels; the steering note (system prompt, mockup parity) carries an explicit "treating the feedback as movie preferences only" framing. The Phase 8 adversarial pass remains the launch gate as planned.
  - **Input clamps at BOTH layers:** route layer REJECTS oversize input with 400 (profile tags/lists, mood text/tags, steering, id lists — each tested with 10k-char strings and oversize arrays); prompt layer TRUNCATES as defense-in-depth (name 50, tag 30 chars + 30 entries, moodText 200, steering 300, title lists 50 — each tested with 10k-char strings / 200-entry arrays). Names (Google-supplied, not part of any request body here) are clamped at the prompt layer, the only layer they pass through.
  - **Rough-day privacy:** three independent test walls — lib (`SessionView` carries only the requester's flag; `getSessionMembersWithProfiles` is documented prompt-only), session GET (exactly one `roughDay` occurrence in the payload, never `rough_day`), match POST (payload contains neither string). The weight note never reveals the toggler ("rough day" never appears in any prompt; single-favored note names only the favored member and instructs the model never to mention or speculate about the reason).
  - **Rate limits:** round cap (10) and monthly cap (`MONTHLY_MATCH_LIMIT`, default 2000) both enforced BEFORE any model call (asserted via the create stub's call count). The SELECT-then-act TOCTOU race on both is the plan's pre-accepted decision (third documented occurrence; blast radius one extra ~$0.04 call).
  - **No secret leakage into logs:** grepped every log/console call in the diff — secrets flow only into `authenticateRequest`/the client factory/TMDB fetchers, never into any log line; the matching_call line contains token COUNTS, ids, and flags only (no prompt text, no PII beyond opaque ids, no key). SQL: every value is bound; the only interpolations are `?`-placeholder lists and a module-constant column list.
  - Considered and accepted without change: profile PUT can trigger up to 10 TMDB fetches per request with no dedicated per-user rate limit (auth-gated, hard-bounded per request, TMDB tolerant — a limiter here would be disproportionate); steering/moodText live inside prompts by design with guardrail + clamps as mitigation.
- **Round 3 (testing-pitfalls conformance):** walked the §1–§7 checklist against all 8 new test files. §4 (empty/boundary inputs) had three real route-layer gaps: no accepted-boundary tests (only rejections were tested) and no empty-moodVibes route test (the quick-match "surprise us" path). Closed with three tests: profile PUT accepts a 30-char tag + exactly-50-entry title list; sessions POST accepts empty moodVibes + exactly-200-char moodText; match POST accepts exactly-300-char steering. §5 concurrency: the two check-then-act shapes are the documented accepted races (unreproducible in the synchronous fake-D1 harness per the Phase 4 investigation). §2: the eval suite's 2 skips are guarded, explained in-file, and accompanied by an always-running guard test.
- **Round 4 (verify the fix):** re-ran the full gate after Round 3's additions — `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 21 files / 249 passed + 2 skipped (up from 246), pristine output; `npx @opennextjs/cloudflare build` succeeded with all 5 new routes registered as dynamic (ƒ). No new findings on the re-pass.

No production-code defects were found in any round; Round 3's coverage gaps were closed with new tests only. Stopped at 4 rounds (Round 3 found gaps, so a Round 4 confirmation pass was required).

**Final Phase 5 gate results:** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` — 21 files / 249 passed + 2 skipped (live evals, guarded), pristine output; `npx @opennextjs/cloudflare build` succeeded.

**Phase 5 commits:** `766d12d` (claim), `dabe57e` (matching engine), `4186d30` (docs), `bd18e30` (live eval suite), `3b25612` (docs), `f9fe41e` (session/profile/search APIs), `a06158d` (docs), `206b76b` (review: boundary tests).

**Notes for Phases 6/7 (UI) — the exact API contracts the UI consumes:**
- `GET /api/user/profile` → `{ profile: { comfortTitles: number[], watchlist: number[], vibes: string[], dealbreakers: string[], streamingServices: string[] } }` (empty arrays when unsaved). `PUT` takes the same five-field object; errors: 400 `{ error }` (validation), 400 `{ error, unknownIds }` (>10 unknown ids), 400 `{ error, failedIds }` (TMDB fetch failure — profile NOT saved).
- `GET /api/titles/search?q=…` → `{ results: [{ tmdbId, title, year, posterPath }] }` (≤10; empty for q < 2 chars after wildcard stripping).
- `POST /api/movie-sessions` body `{ groupId: string|null, moodVibes, moodText, discoverNew?, isQuickMatch?, roughDay?, memberFlags? }` → `{ sessionId }`; 403 `{ error }` non-member/bad memberFlags; 400 validation.
- `POST /api/movie-sessions/[id]/match` body `{ keptTmdbIds?, removedTmdbIds?, steeringFeedback? }` → `{ round: number, response: MatchingResponse, titles: { [tmdbId]: { title, year, posterPath, genres, streaming, lastRefreshedAt } } }`. Errors are `{ error, kind }`: 429 round_limit / monthly_cap / rate_limited, 502 malformed / thin_results, 503 timeout / overloaded — Task 7.5 branches on `kind`; `error` strings are the locked user-facing copy.
- `GET /api/movie-sessions/[id]` → `{ session: { id, groupId, moodVibes, moodText, discoverNew, isQuickMatch, solo, createdAt, roughDay }, round, response, titles }` — `round: 0` + `response: null` + `titles: {}` before the first match; `session.roughDay` is ALWAYS the requesting user's own flag; `titles` covers the latest round's recommendations. This is the results-page reload endpoint.
- Removed-id accumulation is server-side (union of all prior rounds ∪ the current request) — the client should still accumulate locally for optimistic UI, but the server is authoritative.
- All five routes are auth-gated (401 with merged auth headers); session endpoints 404 identically for unknown ids and non-members.


---

## Phase 6 — UI foundation

### Task 6.1 — fonts, design tokens, base layout (`43a7392`)

**Built:** `src/app/fonts.ts` (Fraunces via next/font/google — variable, `opsz` axis, normal+italic, swap; Satoshi via next/font/local — `Satoshi-Variable.woff2` + `Satoshi-VariableItalic.woff2` downloaded from Fontshare's zip API into `public/fonts/`, weight range 300–900). `globals.css` rewritten: every DESIGN.md token as a `:root` custom property under its DESIGN.md name (`--midnight`, `--amber`, `--person-a`, `--space-*`, `--radius-tag/control/panel/pill`, `--ease-enter`, `--duration-*`), then a Tailwind v4 `@theme inline` block mapping them into utility namespaces (`bg-midnight`, `text-cream`, `font-display`, `p-md`, `rounded-panel`, …). `color-scheme: dark`, body = midnight/cream/16px/Satoshi. Reduced-motion kill switch duplicated for `@media (prefers-reduced-motion: reduce)` AND `[data-reduced-motion="true"]` (in-app toggle arrives Task 7.6). `layout.tsx`: font variables on `<html>`, flex column shell (`min-h-dvh`, content `flex-1`, footer at bottom), `SiteFooter` with the two attribution lines + amber Privacy link (44px touch target via `min-h-11`).

**Decisions:**
- Font CSS vars are `--font-fraunces`/`--font-satoshi` from next/font; `--font-display`/`--font-body` are composed in `@theme inline` with fallback stacks (Georgia serif / system-ui). Avoids a self-referential `@theme` var while still exposing `--font-display`/`--font-body` as real custom properties (plan Step 1 requirement).
- Layout test uses `renderToStaticMarkup` (node env), not RTL render — RootLayout renders `<html>`, which React refuses to nest inside a jsdom container div (console.error → violates pristine-output). next/font loaders are vi.mocked (build-time infrastructure, not behavior under test); footer/lang/font-var assertions run against real markup. SiteFooter has its own jsdom RTL test.
- Verified ash-on-midnight contrast ≈ 6.2:1 (≥4.5 AA, DESIGN.md accessibility note).

**Gotchas:** Fontshare zip nests web fonts at `Satoshi_Complete/Fonts/WEB/fonts/`. next/font/local registers the family lowercase ("satoshi") — cosmetic. `.claude/launch.json` created for Browser-pane dev preview (not gitignored; committed).

**Checks:** tsc clean; lint clean; 256 passed + 2 skipped (7 new), pristine; `next build` OK. Browser at 375px: midnight bg, Satoshi/Fraunces confirmed loaded via `document.fonts`, tokens live, no h-scroll, zero console errors.

### Task 6.2 — auth provider + nav (`878e8a4`)

**Built:** `auth-provider.tsx` (context: `{ user, loading, signIn(returnTo?), signOut() }`; single mount-time `/api/auth/me` fetch with a cancelled-flag cleanup; signIn → `/api/auth/google?returnTo=…`, signOut → POST logout then `location.href = "/"`), `use-auth.ts` (context reader, throws outside provider), `nav.tsx` (wordmark + auth area), all wired into `layout.tsx` (AuthProvider wraps Nav/content/footer).

**Decisions:** Sign-in is a `<button>` (navigation with a side effect computing returnTo), not an `<a>`. Menu uses `role="menu"`/`menuitem` — the nav test queries menuitem, not link, because `role="menuitem"` on a `<Link>` replaces its ARIA link role. Avatar `<img>` carries an inline eslint suppression for `@next/next/no-img-element` (image optimization unavailable on Workers — same rationale as the plan's Task 7.1 Poster note). Loading state renders nothing on the right to avoid a sign-in flash. signOut navigation is not unit-tested (jsdom can't do navigation without non-pristine "Not implemented" errors); rendering states + single-fetch behavior are covered per plan.

**Checks:** tsc clean; lint clean; 261 passed + 2 skipped (5 new), pristine. Browser 375px: wordmark in Fraunces italic, amber Sign in, no h-scroll.
