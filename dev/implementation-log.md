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

### Task 6.3 — landing page + privacy policy (`b5927f6`)

**Built:** `page.tsx` replaced: client component; signed-in → `router.replace("/tonight")` (effect), signed-out → editorial landing — Fraunces italic extrabold hook ("What should we watch tonight?", 40px mobile / 56px desktop), miniature taste-map vignette (Alice/person-a, Bob/person-b, overlap phrase in --overlap, sample "Arrival — 92% match" line), amber-fill "Sign in with Google" CTA (midnight text, rounded-control, 48px, focus-visible amber outline), quiet ash ritual line. Texture: inline-style multi-radial-gradient starfield (cream dots ≤0.28 alpha) + amber-glow ellipse at top — intentional per DESIGN.md, not decorative blobs. Entrance: new `--animate-rise-fade` keyframes in `@theme` (fade + 8px drift, 400ms, --ease-enter) with 80ms stagger via animation-delay; reduced-motion rules kill it. `privacy/page.tsx`: static server component, Fraunces headings, 680px measure, sections covering exactly the design-doc §Privacy Principles bullets; mailto link to samuel.carson@gmail.com.

**Bug found & fixed (browser verification caught it; vitest could not):** Turbopack/SWC drops the leading space of some JSXText continuations that start mid-line after a closing tag (`</strong> — mood\n…` served as `</strong>— mood`), while esbuild (vitest) and tsc preserve it — so the suite was green while the served HTML read "Session data— mood". Confirmed via `curl` against the dev server: 3 of 5 structurally-identical lines kept the space, 2 lost it. Fix: meaningful whitespace made explicit with `{" — "}` expressions (compiler-independent). Lesson for Phase 7: any load-bearing space adjacent to an inline element boundary should be an explicit `{" "}`-style expression; visual/served-HTML verification is the only net that catches this class.

**Test note:** privacy test's Anthropic assertion anchors on the unique text node (`/not used to train their models/i`) and checks the containing element mentions Anthropic — `getByText(/Anthropic/)` matched two elements (strong + li direct text).

**Checks:** tsc clean; lint clean; 266 passed + 2 skipped (5 new: 2 landing, 3 privacy), pristine; `next build` OK. Browser: 375px and 1280px, both pages, no h-scroll, no console errors, em-dash spacing verified in served HTML.

### Phase 6 group review (`46cf400`) + phase ship

**Round 1 — correctness:** re-read every new file. One finding: Escape-close of the nav menu left `document.activeElement` on `<body>` (the focused menuitem unmounts). Fixed TDD: failing test (focus assertion) → `menuButtonRef.focus()` on Escape. Outside-click close deliberately does NOT restore focus (user chose a new target).

**Round 2 — DESIGN.md conformance, anti-patterns walked one by one:** purple/violet gradients ✗ none (overlap `#9b7ec8` is a solid sanctioned token); 3-col icon-circle feature grids ✗; centered-everything ✗ (left-aligned type in a centered 680px column); uniform border-radius ✗ (control 8 / panel 16 / pill on avatar); emoji decor ✗; generic hero copy ✗; card grids ✗ (no cards anywhere in Phase 6); Inter/Roboto/system-as-primary ✗ (system-ui only as fallback stack); blobs/wavy dividers ✗ (starfield is the sanctioned texture); cookie-cutter section rhythm ✗ (hook → vignette → CTA). Findings fixed: `text-lg` (18px, off the 12/14/16/20/28/40/56 scale) → `text-xl` on landing subtitle + privacy intro; focus treatment standardized as global `:focus-visible` amber outline in globals.css (CTA's per-element focus classes removed); `viewport.themeColor = #0f1219` added (mobile browser chrome matched midnight). Amber hierarchy audit: fill only on the one CTA, text-only on links, no border-treatment uses yet — correct.

**Round 3 — accessibility:** contrast recomputed (WCAG relative luminance): cream 13.2:1, amber 7.1:1, ash 6.2:1, person-a 5.6:1, person-b 6.1:1, overlap 5.5:1 on midnight — all ≥ AA for body text. Touch targets measured in-browser: nav sign-in 44px, wordmark 44px, CTA 48px, footer Privacy 44px. Privacy mailto is an inline prose link — exempt under WCAG 2.5.8's inline exception (documented decision, not an oversight). Keyboard: real Tab in the Browser pane shows the amber 2px/2px-offset ring; Escape restores focus (tested); menu uses menu/menuitem + aria-expanded/haspopup. `aria-hidden` on starfield + avatar-initial. No h-scroll at 375px on either page.

**Round 4:** clean — no new findings.

**Phase 6 final gates:** tsc clean; lint clean; **267 passed + 2 skipped (269)**, pristine; `next build` clean. Banner ✅ + top table + Overall line flipped.

**Notes for Phase 7:** (1) SWC JSXText gotcha above — use explicit `{" "}`/`{" — "}` for load-bearing whitespace at inline element boundaries, and verify served HTML, not just vitest (esbuild differs). (2) Component-test conventions established: `// @vitest-environment jsdom` pragma + explicit `import { … } from "vitest"` (repo style); RTL renders with fetch stubbed via `vi.stubGlobal` at the network boundary (never mock `useAuth`); anything rendering `<html>` uses `renderToStaticMarkup` with next/font vi.mocked. (3) Utilities now available: `font-display`/`font-body`, `bg-midnight`-style color utilities for every token, `p-md`-style spacing, `rounded-tag/control/panel/pill`, `ease-enter`, `animate-rise-fade` (+ `[animation-delay:…]` stagger), global amber `:focus-visible` ring (don't add per-element focus classes). (4) `data-reduced-motion="true"` on `<html>` already kills animations globally — Task 7.6's toggle just sets the attribute. (5) Auth context: `useAuth()` → `{ user, loading, signIn(returnTo?), signOut() }`; signed-in redirect target `/tonight` already wired from `/`.

---

## Phase 7 — UI flows

### Task 7.1 — shared primitives (`b2d29b2`, `171b654`, `2d59cad`, `9f211bd`, `3e161d5`, `d818ff6`, `c9487a7`)

**Built:** the eight components Tasks 7.3–7.5 compose from, plus the repo-wide safe-rendering guard.

- `eslint.config.mjs` (`b2d29b2`): `{ rules: { "react/no-danger": "error" } }` — `dangerouslySetInnerHTML` is now a lint error everywhere. Verified the rule fires on a scratch violation before committing.
- `bold-text.tsx` (`171b654`): `parseBold(text) → BoldSegment[]` pure function + `<BoldText text>` component. Splits on `**`; odd-indexed parts are bold runs; a trailing unbalanced marker is restored as literal `**…` text so nothing the model wrote is dropped; empty segments from adjacent markers are skipped. Bold → `<strong>`, plain → `<span>`; no HTML path exists.
- `chip.tsx` (`2d59cad`): pill-radius `<button role="checkbox" aria-checked>`, `min-h-11` (44px), amber **border** treatment when selected (`border-amber bg-amber-glow text-amber`) — fill stays reserved for CTAs. `tone="rose"` variant (`--person-b` at 12.5% ground) for dealbreakers. `removable` appends an `aria-hidden` ✕ so the label stays the accessible name.
- `tag-picker.tsx` (`2d59cad`): "Moods & Tones" then "Genres" `role="group"` sections (labels 12px uppercase ash, `aria-labelledby` via `useId`), preset chips from `MOOD_TAGS`/`GENRE_TAGS`, plus a custom-tag input — Enter or the Add button commits, trims, caps at 30 chars, dedupes case-insensitively. Custom tags (anything not in the preset list) render below as removable chips.
- `poster.tsx` (`9f211bd`): plain lazy `<img>` at `https://image.tmdb.org/t/p/{w92|w185|w342}{path}`, alt `"«title» poster"`, in an `aspect-[2/3] rounded-tag bg-charcoal` box. Null `posterPath` → a `role="img"` charcoal fallback showing the title's first letter in Fraunces italic slate. Inline `@next/next/no-img-element` suppression (no image optimization on Workers).
- `title-search.tsx` (`9f211bd`, `3e161d5`): 250ms-debounced `/api/titles/search?q=` fetch, skipped under 2 chars; a `requestSeq` ref discards stale responses; failure shows a quiet ash "Couldn't search right now." Results are a bordered list of 44px rows (small poster + title + ash year); selected titles render as removable chips above the input alongside unselected `quickPicks`. Input is `text-base` (16px) to block iOS auto-zoom.
- `toggle-row.tsx` (`d818ff6`): `<button role="switch" aria-checked>` with label + optional description on the left and a track/knob on the right. Utility action, so no transition — DESIGN.md §Motion says saves and toggles are instant.
- `rough-day-toggle.tsx` (`d818ff6`): switch named `"«name» had a rough day"` with sub-line "Prioritize their preferences over mine tonight", inline 24-viewBox heart SVG (1.5px stroke, rounded joins) that goes `fill="none"` → `fill="var(--amber)"`, and a standing "Only you can see this." line under it.
- `phased-loading.tsx` (`c9487a7`): four-phase narrative in Fraunces italic inside `aria-live="polite"`; `key={index}` re-triggers `animate-rise-fade` per phase (already reduced-motion-gated globally). 900ms hold per phase while waiting; once `done`, later phases advance at 200ms. Calls `onComplete` once, only after the narrative has landed AND `done` is true.

**Decisions:**
- Chip is `role="checkbox"` (plan-specified) rather than `aria-pressed` — selection from a set, not a pressed control. A native `<button>` carries Enter/Space for free, which is asserted rather than assumed.
- Poster inside a TitleSearch result row is wrapped in `aria-hidden` — the row's text is already the accessible name, so a second "«title» poster" label would double-announce.
- `PhasedLoading` reads `done`/`onComplete` through refs updated in a bare effect, so the advance timer depends only on `[index, lastIndex]`. Putting `done` in the dependency array would restart the in-flight timer the moment the response landed, truncating that phase's hold.
- Tag dedupe compares lowercased but stores the user's original casing.

**Gotchas:**
- **`title-search.tsx` originally cleared `results`/`failed` synchronously inside the debounce effect body**, which tripped `react-hooks/set-state-in-effect`. Fixed in `3e161d5` by moving the reset into the query-change and add handlers (`clearResults()`, which also bumps `requestSeq` so any in-flight response is discarded). The generalizable lesson: **a synchronous state reset driven by a user action belongs in the event handler, not an effect body** — the effect only ever schedules the async work.
- **`PhasedLoading`'s hold length is fixed at the moment a phase is entered.** The phase in flight when the response arrives finishes its full 900ms hold; only phases entered *after* `done` fast-forward at 200ms. This is deliberate (no truncated phase mid-fade) and is what the "finishes the current 900ms hold, then fast-forwards" test pins down. Callers must not assume `done` produces an immediate transition.

**Prop contracts (what Tasks 7.3–7.5 consume):**

| Component | Exported props | Other exports |
|---|---|---|
| `BoldText` | `{ text: string }` | `parseBold(text): BoldSegment[]`, `BoldSegment { bold, text }` |
| `Chip` | `ChipProps { label: string; selected: boolean; onToggle: () => void; tone?: "amber" \| "rose"; removable?: boolean }` | — |
| `TagPicker` | `TagPickerProps { selected: string[]; onChange: (tags: string[]) => void; tone?: "amber" \| "rose"; customPlaceholder?: string }` | — |
| `Poster` | `PosterProps { title: string; posterPath: string \| null; size?: "w92" \| "w185" \| "w342"; className?: string }` | — |
| `TitleSearch` | `TitleSearchProps { selected: TitleRef[]; onChange: (titles: TitleRef[]) => void; quickPicks?: TitleRef[]; placeholder?: string }` | `TitleRef { tmdbId: number; title: string; year: number \| null; posterPath: string \| null }` |
| `ToggleRow` | `ToggleRowProps { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }` | — |
| `RoughDayToggle` | `RoughDayToggleProps { name: string; checked: boolean; onChange: (checked: boolean) => void }` | — |
| `PhasedLoading` | `PhasedLoadingProps { done: boolean; onComplete?: () => void; phases?: string[] }` | — |

All eight are named exports (no default exports). Everything except `Poster` and `BoldText` is a `"use client"` component; `Poster` and `BoldText` are server-renderable.

**Checks:** tsc clean; lint clean; **316 passed + 2 skipped**, pristine (49 new: bold-text 9, poster 3, chip 5, tag-picker 10, title-search 9, toggle-row 3, rough-day-toggle 4, phased-loading 6). Debounce and phase-timing tests use `vi.useFakeTimers()` with awaited advances — no arbitrary sleeps, no weakened assertions.

### Task 7.2 — tonight hub + group management (`0653910`)

**Built:** `group-picker.tsx`, `app/tonight/page.tsx`, `app/groups/page.tsx`, `app/groups/join/[code]/page.tsx`.

- **GroupPicker** — `<fieldset role="radiogroup">` with an sr-only legend, one `<label>`-wrapped native radio per group plus "Just me tonight" (always offered, always last, reported as `null`). Native radios buy Tab-to-checked + arrow-key movement for free, which is exactly DESIGN.md's keyboard requirement. Selected row = amber border + amber-glow; focus ring via `has-[:focus-visible]` on the label. Exports `defaultGroupSelection(groups)` and `MemberAvatars`.
- **`/tonight`** — first-name greeting that frames the picker ("Alice, who's watching tonight?"), the picker, then the two entries: amber-FILL `Quick match` and a **slate**-outline `The full ritual`. The secondary CTA deliberately does not use an amber border — amber border is the *selection* treatment in DESIGN.md's three-level hierarchy, and the picker rows already own it. Chosen group rides along as `?group=<id>`; solo omits it. Skeleton rows while groups load, ash strapline, quiet "Groups & invites" link.
- **`/groups`** — cards (DESIGN.md sanctions cards for group management), each with name, comma-joined member list, overlapping avatars, the invite link as selectable text plus a Copy button, and an inline two-step leave confirm. Below: "Start a group" (amber-fill primary) and "Join with a code" (outline), side by side from 640px. Empty state teaches what a group is.
- **`/groups/join/[code]`** — confirm by CODE alone in a framed amber panel. No pre-join lookup exists and none is made (asserted: zero non-auth fetches before confirm), so the group name is only ever known *after* joining. Signed out → a sign-in link carrying `returnTo` back to this invite.

**Decisions:**
- **`?group=<id>` query param** is the hub → `/quick` `/ritual` handoff (plan didn't specify). Matches `POST /api/movie-sessions`'s `groupId: string | null` — absent means solo.
- **With 2+ groups the hub starts on solo.** The plan locks auto-selection only for "exactly one group". Preselecting one of several risks matching for the wrong group; solo is always safe and always actionable. The rule lives in exactly one place, `defaultGroupSelection()`.
- **Invite codes are case-sensitive** (`/^[2-9A-Za-z]{8}$/`). The join input trims and takes the last path segment (so pasting the whole invite link works) but **never** normalizes case. `autoCapitalize="none"` + `autoCorrect="off"` on the field.
- **Inline leave confirm, not a modal** — `impeccable`'s product register treats modals as a last resort, and inline needs no focus trap. Focus handoff is tested instead: trigger → confirm, cancel → trigger, success → the visible `h1`.
- **`googleSignInUrl()` extracted from `auth-provider.tsx`** so `signIn()` and the join page's sign-in `<a>` build the URL in one place. The join page uses a real anchor (not `next/link`) because it leaves the App Router for an OAuth endpoint; that also makes `returnTo` assertable without mocking `useAuth`.
- After any mutation the page **re-reads `GET /api/groups`** rather than patching local state — `POST /api/groups/join` returns only `{ id, name }` (no members), so one reload path beats two divergent ones.

**Gotchas:**
- **`<fieldset>` has a UA-default `min-inline-size: min-content`** and therefore refuses to shrink below its content — the picker forced the document to 435px at a 375px viewport. `min-w-0` on the fieldset fixes it. Invisible to vitest; found by measuring `document.scrollWidth` in the browser.
- **A near-zero `animation-duration` does NOT fast-forward an animation.** Chrome pins it at `currentTime: 0` / `playState: "running"`, so with `animation-fill-mode: both` the element sits on its `from` keyframe forever. `globals.css`'s reduced-motion rules used `0.01ms`, which meant **every `--animate-rise-fade` element — including the whole Phase 6 landing page — rendered at opacity 0 for reduced-motion users.** Fixed to `animation: none !important`; `src/app/globals.css.test.ts` guards both entry points (media query + `data-reduced-motion`).
- **`react-hooks/set-state-in-effect` fires on a `useCallback` invoked synchronously in an effect body**, even when that callback's own setState calls sit behind an `await`. The lint-clean shape is the repo's existing one (`auth-provider.tsx`, `tonight/page.tsx`): an async IIFE inside the effect with a `cancelled` flag. The reusable fetch was made a module-level pure function returning `null` on failure, so no state-setting function is called from an effect at all.
- **`ring-*` compiles to a `box-shadow`**, which DESIGN.md bans outright. Avatar separators use `border-2 border-midnight` instead. There are now zero shadow utilities in `src/`.
- `use(params)` in a client page suspends on first render, so RTL renders must be `await act(async () => render(...))` — otherwise React logs an un-awaited-act warning (non-pristine) and the tree never leaves the Suspense fallback.

**Contracts for Tasks 7.3–7.6:**

| Route | Reads | Notes |
|---|---|---|
| `/tonight` | `GET /api/groups` | Signed-out → `router.replace("/")` |
| `/quick?group=<id>` | — | Task 7.4. Param absent = solo |
| `/ritual?group=<id>` | — | Task 7.3. Param absent = solo |
| `/groups` | `GET /api/groups`, `POST /api/groups`, `POST /api/groups/join`, `POST /api/groups/[id]/leave` | |
| `/groups/join/[code]` | `POST /api/groups/join` | `params` is a Promise; unwrapped with `use()` |

`GroupPickerProps { groups: GroupOption[]; value: string | null; onChange: (groupId: string | null) => void }`; `GroupOption { id, name, members: { userId, name, avatarUrl }[] }`; `defaultGroupSelection(groups): string | null`; `MemberAvatars({ members })`. `googleSignInUrl(returnTo): string` from `@/components/auth-provider`.

**Checks:** tsc clean; lint clean; **358 passed + 2 skipped**, pristine (31 new: picker 8, tonight 8, groups 16 incl. review additions, join 7, globals.css 3 — see the review entry); `npx @opennextjs/cloudflare build` clean.

### Slice 7a review (`4f1d80a`) — 4 rounds

**Round 1 — correctness.** Re-read all four new files plus the two touched Phase 6 files. Four findings, all fixed TDD: (1) `leaveGroup` discarded `post()`'s error string — a failed leave closed the confirm and reloaded the list as if it had worked; now surfaced on the owning group's card, and the test uses *two* groups because the first fix rendered a page-wide error string on every card. (2) The hub greeting read ", who's watching tonight?" when the stored name is empty — reachable, since `api/auth/google/callback` stores `(claims.name as string) || ""`. (3) The join page's OAuth sign-in was a `next/link` pointed at an API route. (4) `<code>` around an invite URL, rendered in the body face — a URL is not source.

**Round 2 — DESIGN.md conformance, anti-patterns walked one by one.** Purple/violet gradients ✗ (no gradients in this slice at all); 3-col icon-circle grids ✗ (the only grid is a 2-col form pair, no icons); centered-everything ✗ (left-aligned in a 680px column; the join code is the one centered element and it is a single framed value); uniform radius ✗ (panel 16 / control 8 / pill, three distinct); emoji ✗; generic hero copy ✗; card grids as default ✗ (cards only on `/groups`, explicitly sanctioned, and as a vertical list not a grid); Inter/Roboto/system ✗ (fallback stack only); blobs/wavy dividers ✗; cookie-cutter rhythm ✗. `impeccable`'s absolute bans also clean: no side-stripe borders, no gradient text, no glassmorphism, no hero-metric block, no numbered scaffolding, and no tracked-uppercase eyebrow *above sections* — the two uppercase 12px ash labels are value labels ("Invite link", "Invite code"), the system vocabulary the plan specifies, while every real section uses a heading. Type scale audited: 12/14/16/20/28/40 only. Two nits fixed: `ring-*` → `border-*` (ring compiles to a box-shadow, which DESIGN.md bans), and skeleton heights off the 4px scale.

**Round 3 — accessibility.** Contrast recomputed for every pair used, including composites: cream/charcoal 14.5, cream/midnight 13.2, amber/charcoal 7.9, amber/midnight 9.0, amber/amber-glow-over-midnight 7.3, ash/charcoal 5.4, ash/midnight 6.2, ash/amber-glow 5.0, sage/charcoal 5.5, midnight-on-amber 9.0 — all ≥ AA. **One failure: ember text on charcoal = 4.12:1** (the "Yes, leave" label); the destructive signal moved to the border with a cream label (14.5) and a midnight-on-ember hover fill (4.7). Findings fixed: focus was dropped on `<body>` whenever the leave confirm opened, cancelled, or completed (the same class the Phase 6 nav review found) — handoff now goes confirm → trigger → visible `h1`, all three tested; same on the join success screen. List-load failures got `role="alert"` (they appear after load). The copy confirmation was a live region *inside* the button whose accessible name also changes — replaced with one page-level sr-only region. Pasting the full invite link into the code field truncated to `http://` — the last path segment is taken now. Keyboard verified live in the browser: Tab reaches the checked radio, ArrowUp/Down moves selection *and* updates the CTA hrefs, and the amber 2px/2px-offset ring lands on the row via `has-[:focus-visible]`. All targets measured ≥44px.

**Round 4 — final pass.** Two more, both real: (1) the reduced-motion `animation-duration` defect above — reduced-motion users saw blank content on the landing page and the hub; (2) a long invite code in the URL (arbitrary user input) pushed the page to 1290px at 375px — `break-all` fixes it, and `[text-indent:0.2em]` compensates the trailing letter-space so the tracked code sits truly centred.

**Visual verification — what was and was not checked.** The dev server is `next dev`, which has **no Cloudflare bindings** (`next.config.ts` does not call `initOpenNextCloudflareForDev`), so `/api/auth/me` cannot succeed and a real signed-in session is impossible without `npm run preview` + `.dev.vars` + a Google OAuth client — all Phase 8 (task 8.2). Verified directly in the Browser pane at 375px and 1280px: the **join page** unauthenticated end to end (real route, real `use(params)` — confirming no missing Suspense boundary), and the **hub and groups pages** rendered through a temporary scratch harness at `/visual-scratch` that wrapped the real page components in a fake `AuthContext` with `fetch` stubbed at the network boundary (deleted before commit; never staged). Under that harness: no horizontal scroll at either width, zero console errors, DESIGN.md tokens live (measured `rgb(232,168,73)` amber, Satoshi/Fraunces loaded), every interactive element ≥44px, real Tab/Arrow keyboard traversal, the amber focus ring, the empty state, the leave-confirm state, and the reduced-motion fix. Load-bearing whitespace was checked against the **compiled bundles** rather than served HTML (these pages render nothing server-side while signed out): `"Leave ", name, "? You'll need…"` and the two em-dash strings all survived SWC intact. **Not verified:** any real end-to-end flow against D1 — no group was actually created, joined, or left against the database; those paths are exercised only by the API route tests (Phase 4) and the stubbed page tests. Phase 8.2 must run them for real.

### Task 7.3 + 7.4 — full ritual and quick match (`ab710bf`, `74e715d`, `f889ad6`, `621ec45`, `e61ccee`)

**Built:** the two entry flows the hub's CTAs point at, plus the catalog reads they needed.

- **`src/app/api/titles/search/route.ts`** (`ab710bf`): two read modes added. `?ids=1,2,3` resolves saved tmdb ids from D1 **in the caller's order** (a profile's title lists are user-ordered, not popularity-ordered), deduped, capped at 100. `?popular=1` returns the top 12 by popularity for quick picks. Both take precedence over `q`, and neither falls back to TMDB. See the plan's Deviations entry for why this was unavoidable: the profile GET returns bare `number[]` and nothing resolved them, so "ProfileEditor pre-filled from `GET /api/user/profile`" was literally unbuildable. The 100 cap is exactly one full profile (50 comfort + 50 watchlist), so it can never truncate a real one.
- **`progress-steps.tsx`** (`74e715d`): `<nav aria-label="Ritual progress">` → `<ol>`. Completed steps are buttons named `Step N: «name»`; the current step is a span with `aria-current="step"`; upcoming steps are inert. Below 640px only the current label paints (`sr-only sm:not-sr-only`) so a long member name can't force h-scroll — the labels stay in the a11y tree at every width, and `<ol>` semantics carry position without redundant numbering.
- **`profile-editor.tsx`** (`74e715d`): fully controlled five-section form (comfort, watchlist, wants, dealbreakers rose-toned, streaming services) over the 7.1 primitives. Exports `ProfileDraft` and `STREAMING_SERVICES`. Controlled rather than self-loading precisely so Task 7.6 can mount it standalone.
- **`mood-screen.tsx`** (`74e715d`): vibe TagPicker, discover-new ToggleRow, 200-char note with a live counter, the rough-day toggle (hidden when solo — with one member `computeWeightNote()` returns "no weighting", so the control would be a lie), and the session summary.
- **`app/ritual/page.tsx`** (`f889ad6`): stepper orchestrator. Steps are `[me, ...others, "Mood"]`. Step 0 is the only editable one; each other member's step names them, says their saved profile will be used, and carries the rough-day toggle they set themselves. Mood → `POST /api/movie-sessions` → `POST …/match` → `router.push('/results/[id]')`.
- **`app/quick/page.tsx`** (`621ec45`): one screen — who's watching, ≤3 tap-to-set chips, rough-day toggle, one CTA. Zero tags is a first-class path.
- **`src/lib/session-flow.ts`**: the fetch layer both pages share.

**Decisions:**
- **The rough-day toggle is labelled for the person it benefits, not the person who sets it.** `computeWeightNote()` treats `roughDay: true` as "deprioritise this member's OWN preferences", so on member M's step the label names *everyone else* and the flag written is `memberFlags[M]`. Getting this backwards would invert the entire feature. `src/app/ritual/page.test.tsx` pins it: toggling on Bob's step (labelled "Alice Chen had a rough day") sends `memberFlags: { u2: { roughDay: true } }`.
- **The session summary carries no rough-day signal**, dropping the mockup's "💛 Prioritizing «name»" line. Tested as a mechanism assertion, not a copy assertion: the summary's text must not match `/rough day|prioriti/i`, and the page must mention it exactly once — on the toggle its owner set.
- **A failed profile load blocks the ritual** instead of rendering an empty editor, because "Continue" would then PUT the saved profile away. The same guard is why `fetchProfileDraft()` returns `null` (not a partial draft) when the id-resolution half fails.
- **A failed match is retried against the session already created**, never a second one — asserted by counting `POST /api/movie-sessions` calls across a retry.
- Match errors are rendered from the server's `error` string (the locked user-facing copy from Task 5.4), not re-worded client-side. Task 7.5 will branch on `kind`; these flows only need the string.

**Gotchas:**
- **`vi.advanceTimersByTimeAsync(5000)` in a single `act()` only ever fires PhasedLoading's first phase.** Each phase's timer is scheduled by the effect that runs *after* the previous phase renders, so one large advance finds only one pending timer; React never flushes in between. The fix is `settleNarrative()` — eight 1000ms advances, each in its own `await act()`, so effects flush and the next timer is scheduled. This cost a real debugging cycle (reproduced in isolation before touching the page). **Any future test that drives an effect-chained timer sequence must advance in steps.** The assertion was never weakened.
- **A near-zero-height check on interactive elements is a better a11y probe than eyeballing.** Measuring `getBoundingClientRect().height < 44` across all 86 interactive elements in the browser caught nothing in app code — but it is what made "≥44px" a verified claim rather than an assumed one.
- `role="group"` must be set explicitly on a `<section aria-labelledby>`; a named `<section>` is a `region` landmark, and five of those in one form clutters the landmark list.
- Two group members can share a display name. `key={name}` in the summary and `key={label}` in the stepper both collide; both are keyed by position now.

**Review (5 rounds, `e61ccee`):**
- **Round 1 — correctness.** Five findings: a fourth quick-match tag was a silent no-op (now explains itself in the live region); a failed group load left quick match *looking* solo while still matching for the group (now says so, and the CTA still works because the URL's group id is what the server matches on); dead `EMPTY_DRAFT` export; an unreachable `undefined` check in `fetchGroup`; and `startSession` returning a non-null error string on success (a trap for Task 7.5, fixed to `string | null`).
- **Round 2 — DESIGN.md, anti-patterns walked one by one.** Purple/violet gradients ✗ (no gradients at all); 3-col icon-circle grids ✗; centered-everything ✗ (left-aligned in a 680px column; only PhasedLoading centres, which is its 7.1 spec); uniform radius ✗ (control 8 / panel 16 / pill); emoji ✗; generic hero copy ✗; card grids ✗ (one summary panel, not a grid); Inter/Roboto/system ✗; blobs/dividers ✗; cookie-cutter rhythm ✗. `impeccable`'s bans also clean: no side-stripe borders, no gradient text, no glassmorphism, no hero-metric block. Numbered markers are exempt — a stepper genuinely *is* a sequence. Three fixes: the current step marker used amber **fill**, which DESIGN.md reserves for CTAs (now border + amber-glow, the "active state" treatment); the `✓` glyph became a 1.5px-stroke inline SVG matching the icon system; the summary label was inventing a `text-sm tracking-wide` variant instead of the established 12px `tracking-wider` vocabulary. Type scale audited: 14/16/20/28/40 only.
- **Round 3 — accessibility.** Every pair recomputed including composites: cream/midnight 16.5, warm-white/midnight 17.5, ash/midnight 6.2, amber/midnight 9.0, ember/midnight 4.7, cream/charcoal 14.5, ash/charcoal 5.4, amber/glow-on-midnight 7.3, ash/glow-on-midnight 5.0, midnight-on-amber 9.0 — all ≥ AA. **ember/charcoal is 4.12 and would fail, but ember is only ever used on midnight here** (checked, not assumed). Two findings: the stepper swapped content without moving focus (now focuses the new step's heading, `tabIndex={-1}`), and MoodScreen had a hard-coded `id="mood-note"`.
- **Round 4.** Two more: the match-error screen dropped focus onto `<body>` — the same class slice 7a's review found twice — and two members sharing a name collided on a React key.
- **Round 5.** Converged. One latent hard-coded page id aligned to `useId()`; nothing else found. Also removed `outline-none` from the programmatic focus targets: `:focus-visible` already gives keyboard users the amber ring on those headings and stays silent for mouse users, so suppressing it only cost the keyboard case.

**Visual verification — what was and was not checked.** `next dev` has no Cloudflare bindings, so a real signed-in session is impossible (Phase 8.2). Both flows were exercised in the Browser pane through a temporary `/visual-scratch` harness (fake `AuthContext` + `window.fetch` stubbed at the network boundary), deleted before committing and never staged. **Verified at 375px and 1280px:** `document.documentElement.scrollWidth` equals the viewport at every step of both flows (375/375 and 1265/1280) — no horizontal scroll, including with a deliberately long member name ("Bartholomew Reyes-Whitfield"); **zero console errors** across the whole traversal; all 86 interactive elements measured ≥44px (the only sub-44 hits were the harness's own toggles); real `Tab` reaches the chips and lands the amber 2px/2px-offset `:focus-visible` ring; the 3-tag ceiling and its new notice; the rough-day toggle reading "Alice Chen had a rough day" on Bob's step (the beneficiary framing, confirmed visually); the summary panel showing no rough-day signal after the flag was set; PhasedLoading in Fraunces italic; focus landing on the step heading and on the error heading after a 403; and reduced motion via `data-reduced-motion="true"` (computed `animation-name: none`, `opacity: 1` — the 7a fix holds on these surfaces). The `router.push` hand-off was confirmed end to end: the browser landed on `/results/s1` and returned Task 7.5's expected 404. **Not verified:** anything against real D1 or a real Anthropic call — no session was created, no match was run, no profile was saved to the database. Phase 8.2 must run those for real.

**Contracts Task 7.5 inherits:**

| What | Value |
|---|---|
| Route | `/results/[sessionId]`; `params` is a Promise — unwrap with `use()` and mount under `<Suspense>` (see `groups/join/[code]`) |
| How state arrives | **Only the sessionId, in the URL.** No client state is handed over — both flows POST session *then* match before navigating, so round 1 is already persisted |
| Load on mount | `GET /api/movie-sessions/[id]` → `{ session, round, response, titles }`; `round ≥ 1` and `response`/`titles` populated on arrival from either flow |
| Must NOT do | Re-POST match on mount — that would burn a second round of the 10-round budget |
| Error taxonomy | `{ error, kind }`; 7.3/7.4 render `error` verbatim and leave `kind` branching to 7.5 |
| Reusable | `requestMatch(sessionId)` and the `send`/`getJson` helpers in `src/lib/session-flow.ts`; `PhasedLoading` for the refinement wait |
| Rough-day | `session.roughDay` is ALWAYS the requesting user's own flag — never render it as anyone else's, and never attribute the weighting line |
| Task 7.6 | Mount `<ProfileEditor value onChange quickPicks />` and drive it with `fetchProfileDraft()` / `saveProfile()`; both already handle the load-failure guard |

**Checks:** tsc clean; lint clean; **407 passed + 2 skipped (409)**, pristine (49 new: search route 6, progress-steps 5, profile-editor 7, mood-screen 9, ritual 11, quick 11); `npx @opennextjs/cloudflare build` clean. Working tree clean at each commit; every `git add` used explicit paths.

### Task 7.5 + 7.6 — results experience and profile settings (`3cb4b59`, `0b37b56`, `d1ddabf`, `747c91e`)

**Built:** the design centrepiece and the settings surface.

- **`taste-map.tsx`** — editorial, no cards. A legend (dots + names, so colour is never the sole cue), one section per member headed in their person colour with a full-width top rule in that colour, prose at 62ch, and vibe/genre tags outlined in the same hue. The overlap zone opens with a 2px `linear-gradient` running each member's colour into `--overlap` — the two tastes meeting, drawn literally — then the shared vibes and a "Where it pulls" list marked with ember dashes. `personColor(i)` wraps a four-colour curated set.
- **`ranked-list.tsx`** — an `<ol>` of magazine spreads: the poster takes most of the measure on a phone with the Fraunces rank numeral and a tabular-nums score badge in the air beside it, the title running the full measure below; at `sm+` the poster row-spans and the type sets in the second column. ♥/✕ are 44px `aria-pressed` buttons (kept fills sage, removed fills ember), streaming reads "On Netflix" / "Rent on Prime Video", dated "as of 4 Jul 2026" once the catalog row is over 14 days stale.
- **`conversational-view.tsx`** — the narrative as a programme note: the opening paragraph in Fraunces when there is a body to lead into, the rest in Satoshi at 62ch, `**titles**` through `BoldText`.
- **`refine-panel.tsx`** — kept/removed counts plus earlier rounds, a 300-char steering note with a live counter, "Round N of 10", and the four exact CTA labels from the mockup.
- **`app/results/[sessionId]/page.tsx`** — three keyboard-navigable tabs (roving tabindex, arrows, Home/End, wrap) over those views, plus the refinement loop.
- **`app/profile/page.tsx`** — ProfileEditor standalone, the reduce-animations preference, sign out, and a typed delete confirmation that states the anonymisation promise.

**Decisions:**
- **The results page never POSTs match on mount.** Round 1 is already persisted by the flow that navigated here; re-posting would burn one of ten. A session that genuinely has no round gets an explicit CTA instead of an automatic call.
- **A failed refinement keeps the current picks on screen.** The error is an alert beside them, framed by `kind`, with the server's own string as the body so the two can never drift. `thin_results` offers the dealbreakers page rather than a retry (retrying an impossible brief just fails again); `round_limit` closes refinement outright via `RefinePanel`'s new `exhausted` prop.
- **The weighting line is the viewer's own request, restated.** The client only ever knows its own flag, and with both members flagged the engine applies no weighting at all — so any claim about the actual weighting could be false. "At your request, tonight's picks lean toward everyone else." is true by construction, names nobody, and never says "rough day".
- **The kept heart fills sage, not amber.** DESIGN.md gives the amber-filled heart to the rough-day toggle; one glyph, two meanings would be worse than a second colour.
- **The `<html>` attribute is the runtime source of truth for reduced motion**, seeded from storage by `ReducedMotionBoot` in the layout and read through `useSyncExternalStore`. Copying it into React state in an effect trips `react-hooks/set-state-in-effect`, and that rule is right here.

**Gotchas:**
- **This project's vitest/jsdom has no working `localStorage`.** `window.localStorage` is an accessor that returns `undefined`; `sessionStorage` works, and real browsers are fine. `reduced-motion.ts` takes an injectable store as a result — which turned out better anyway: the no-storage and throwing-storage paths are now tested for real rather than mock-patched. The page test defines a working `window.localStorage` with `Object.defineProperty`.
- **The Browser pane's screenshot can lag the DOM.** Twice a screenshot showed a "bug" (posters missing, then the write-up rendering only its first paragraph) that `getComputedStyle`/`getBoundingClientRect` immediately disproved. Measure with JS; treat one screenshot as a hint.
- **Two `.click()` calls in one synchronous browser-console block both read the pre-click props.** React batches within a task, so the first rating was silently dropped — indistinguishable from a state-machine bug until the clicks were separated by an await. A human cannot produce this.
- **Element rects do not catch block-level text overflow.** A long word inside a `<p>` overflows visually while the element's box stays at container width; only `scrollWidth > clientWidth` finds it. This is what surfaced the break-words defect below.

**Checks:** tsc clean; lint clean; **501 passed + 2 skipped (503)**; `npx @opennextjs/cloudflare build` clean. Working tree clean at each commit; every `git add` used explicit paths.

### Phase 7 close-out review (`747c91e`, `5520acc`, `835ecc7`, `00986f2`, `8940ebc`, `d4da59b`, `32ca649`) — 7 rounds

**Round 0 — visual verification** (before the review proper, in the Browser pane through a temporary `/visual-scratch` harness with a realistic six-recommendation response and real TMDB posters; deleted before committing, never staged). Three findings, none observable in jsdom: the ranked list was a *thumbnail* list rather than the poster-dominant spread DESIGN.md asks for (a 132px poster in a 343px column) and was restructured; the list was a `<ul>` though its ranking is real information; and four `text-slate`-on-dark uses measured ~1.3:1 and were effectively invisible, including `Poster`'s own fallback initial from Task 7.1.

**Round 1 — correctness.** Five findings. `parseMatchingResponse` did not dedupe `tmdbId`, so a repeated recommendation would render twice with two identically-named buttons that toggled as one. `TasteMap` built its heading ids from the model's `userId` — two maps in one document would collide, and a `userId` containing a space silently breaks `aria-labelledby`, which is a space-separated id list. Both `TasteMap` and `RankedList` keyed children on model-authored strings ("Thriller" as both a vibe and a genre affinity is ordinary output). The strapline "and"-joined every mood vibe. One dead constant.

**Round 2 — DESIGN.md conformance, anti-patterns walked one by one.** Purple/violet gradients ✗ — the overlap treatment is a 2px person-colour-to-`--overlap` hairline, which is that token's documented role and the treatment Task 7.5 explicitly requires, not a decorative wash; 3-col icon-circle grids ✗; centred-everything ✗; uniform radius ✗ (four distinct: tag/control/panel/pill); emoji ✗ (scanned by codepoint range); generic hero copy ✗; card grids ✗ — neither core surface has a card container, and cards appear only on the refine panel, the error alert and the delete confirm, all sanctioned utility surfaces; Inter/Roboto/system ✗; blobs/dividers ✗. `impeccable`'s absolute bans also clean: no side-stripe borders (the member rule is `border-t`), no gradient text, no glassmorphism, no hero-metric block, no eyebrow-per-section (one "Where it pulls" sub-label, and every real section has a heading). Type scale audited to 12/14/16/20/28/40 only. **One real finding — the "text that overflows its container" ban:** no AI- or user-authored string on these surfaces declared word breaking. Measured in a 343px container, one long token pushed the member heading to 452px, the tension list to 428px and a ranked-list item to 846px. Fixed and re-measured at zero overflow.

**Round 3 — accessibility.** Every pair recomputed against its actual ground: cream/midnight 16.5, warm-white 17.5, ash 6.2, amber 9.0, sage 6.3, ember-on-midnight 4.7, person-a 5.6, person-b 6.1, overlap 5.5, person-c 7.3, person-d 7.3, cream/charcoal 14.5, ash/charcoal 5.4, midnight-on-amber 9.0. **Three failed:** "Only you can see this." at ash/70 = 3.65:1; the refine panel's "N removed" as ember on charcoal = 4.12:1 (the same pair slice 7a caught on the leave button); and the disabled regenerate button as ash on slate = 4.06:1. All fixed. Separately, **both tab panels went h1 → h3** — the refine panel's h2 sits after them in document order and does not repair the skip — so member, overlap and pick titles are h2 now and the failure framing is a real h2. Guarded by a test that walks headings in document order in all three views.

**Round 4 — security and safe rendering.** Every model-authored field traced to its render path: names, summaries, vibes, genre affinities, overlap summary, shared vibes, tension points, explanations and scores all reach the DOM as JSX children; the narrative goes through `BoldText`, which only emits `<strong>`/`<span>`. The one attribute carrying model-adjacent data is the poster `src`, built on a fixed `https://image.tmdb.org` prefix so it cannot change scheme. After round 1 the model's `userId` reaches the DOM nowhere at all. `react/no-danger` clean, no `dangerouslySetInnerHTML` in `src/`. XSS literal-render tests cover all three views plus each component. **One finding:** `ERROR_FRAMING` was an object literal indexed by the `kind` the server sends, so a kind of `"constructor"` resolved to an inherited property, the `??` fallback never fired, and the failure heading rendered empty. It is a `Map` now.

**Round 5 — fresh re-read.** Three findings: the profile page kept showing "Saved" after further edits; `ConversationalView` split on `"\n"` only, leaving a stray `\r` inside each paragraph of a CRLF response; and `keptTmdbIds` was uncapped while the match route rejects lists over 50, which would have dead-ended refinement on an unusually long response.

**Round 6.** One misplaced comment. **Round 7 — converged, nothing found.**

**Visual verification — what was and was not checked.** `next dev` has no Cloudflare bindings, so a real signed-in session remains impossible (Phase 8.2). Both surfaces were exercised through the temporary `/visual-scratch` harness (fake `AuthContext` + `window.fetch` stubbed at the network boundary) with a deliberately realistic response: six recommendations, real TMDB poster paths verified 200 by curl, one null-poster title to exercise the fallback, one stale `lastRefreshedAt`, and believable multi-paragraph taste-map prose. **Verified:** all three tabs at 375px and 1280px; `document.documentElement.scrollWidth` equal to the viewport at both widths and on every tab; zero console errors across the traversal; the refinement round trip end to end — ratings set, `PhasedLoading` shown, `{keptTmdbIds:[27205],removedTmdbIds:[496243],steeringFeedback:""}` posted, "Round 2 of 10" and "+ 1 from earlier rounds" rendered after; real `ArrowRight` keyboard traversal moving both selection and focus and swapping the panel; the amber 2px/2px-offset `:focus-visible` ring measured as `rgb(232,168,73)`; every interactive element ≥44px except the pre-existing footer "Privacy" link; reduced motion via `data-reduced-motion="true"` computing `animation-name: none` / `opacity: 1` on every panel; the profile page's pre-filled editor, delete confirmation, and the reduce-animations toggle writing `localStorage` and surviving a full navigation to another route. Long-token overflow was measured against a 343px probe container because the pane's viewport got stuck at 863px mid-session. **Not verified:** anything against real D1 or a real Anthropic call — no session was created, no match was run, no profile was saved, no account was deleted against the database. Phase 8.2 must run all of those for real.

## Phase 7 client-side bug fixes (post-review hunt)

Four confirmed client-side bugs from a follow-up hunt, each fixed under strict TDD (one commit per bug).

- **TagPicker folded a wrong-cased preset into a decoupled duplicate.** `addCustomTag` deduped case-insensitively against `selected` but the "is this a preset" split (`customTags = selected.filter((t) => !PRESETS.includes(t))`) was case-sensitive, and the entry was pushed verbatim. Typing `horror` added a custom `"horror"` chip while the `"Horror"` preset stayed unselected; tapping it then produced `["horror","Horror"]` — two near-duplicate tags into the prompt, two decoupled toggles. Fix: a preset-matching custom entry (any casing) is added in the preset's canonical casing, so it toggles the preset chip. Genuinely-custom entries keep their casing. Honors the header comment's "case-insensitive dedupe" promise.
- **Groups page: `busy` semaphore vs per-button `disabled` mismatch.** Every mutation guard early-returns on a truthy `busy` (single-valued: `"create" | "join" | "leave-{id}" | null`), but each button disabled only its own specific value. With a leave in flight (`busy = "leave-g1"`), Create/Join stayed enabled; a click hit the guard, saw `busy` truthy, and returned silently — no request, no loading label, no feedback. Fix: each mutation control now disables on `busy !== null`, matching its guard, while keeping its own per-action label (`Creating…`/`Joining…`) and the leave-confirm UX. Only the `disabled` expressions changed; all controls already carry `disabled:opacity-50` and 44px targets.
- **Results page asserted "doesn't exist / isn't yours" on any load failure.** `session-flow.getJson` collapsed non-OK HTTP, a network throw, and a parse failure into a uniform `null`, so a transient 500 or a dropped connection rendered the same nonexistence copy with only a dead-end "Back to tonight" link. `fetchSessionResults` now returns a discriminated `SessionLoad` — `"missing"` only for the member-scoped 404 (kept indistinguishable between "unknown" and "not a member", so existence never leaks), `"error"` for transient failures. The page keeps the original copy for `"missing"` and shows a distinct "We couldn't reach tonight's picks / connection blip, not a missing session" screen with a **Try again** button (re-runs the load via a `reloadNonce` effect dep) for `"error"`. Amber hierarchy honored: one fill CTA + a text-only "Back to tonight" link.
- **Quick match dropped the private rough-day toggle when the group fetch failed.** On `fetchGroup` failure the banner says "the match is still for the whole group" and the URL's `groupId` is still sent, so the session genuinely runs as a group — but `others = (group?.members ?? []).filter(...)` became `[]`, and the toggle was gated on `others.length > 0`, so it (and the who's-watching line) vanished. The caller's private rough-day flag was silently withheld. Fix: render the toggle when `others.length > 0 || (groupId !== null && groupFailed)`, framing the beneficiary generically ("The rest of the group") when names are unavailable. The flag stays the caller's own (`memberFlags` still `{}`); no other member's flag is shown or sent, so the private-toggle invariant holds.

**Gates (all four commits):** `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` 519 passed + 2 skipped, pristine. One commit per bug, explicit `git add` paths.

---

## Phase 8 — Verification & bug hunt (2026-07-19)

**8.1 gates:** `npx tsc --noEmit`, `npm run lint`, `npm test` (519 passed + 2 skipped, pristine), `npx @opennextjs/cloudflare build` — all clean.

**8.2 partial (real Workers runtime boot).** No TMDB/Anthropic/Google credentials in this environment, so the full end-to-end (real seed, OAuth, real match) is blocked and captured in `docs/deploy.md`. What WAS verified — and could not be at any earlier phase, since `next dev` has no CF bindings: applied the schema to local D1, built with OpenNext, and booted `npx wrangler dev` (the real Workers runtime). `/` and `/privacy` served HTTP 200, `/api/auth/me` correctly returned 401 (auth ran, no session), `/api/titles/search` and `POST /api/groups` correctly 401'd unauthenticated, and a direct `SELECT COUNT(*) FROM titles` against the local D1 binding returned 0 (empty catalog, as expected with no seed). A Browser-pane screenshot of `/` confirmed the DESIGN.md landing renders in the real runtime: Fraunces italic display, the person-a/person-b/overlap taste-map vignette, amber accents on midnight. D1 provisioning done: `movie-night-db` created in ENAM (`46d47bab-95d7-4bfa-9923-e51b72fc15f1`), schema applied to remote (13 tables), `wrangler.jsonc` updated off the zero placeholder.

**8.5 bug hunt — 4 parallel hunters, 10 confirmed defects fixed TDD.** Dispatched `bug-hunter-holistic`, `bug-hunter-multipass`, `bug-hunter-differential` (server scope, Opus/Fable), and `bug-hunter-exploratory` (client scope, Sonnet). Every finding was independently verified against the code before fixing; the critical one was triple-confirmed. Each fix is its own commit, failing-test-first.

Server (my fixes):
- **[critical] D1 100-bound-parameter limit** (`4df5066`). Two profiles × (50 comfort + 50 watchlist) union up to 200 ids into one `IN (...)` in `getTitlesMap` and `selectCandidates`; D1 caps at 100, so the core match path 500'd for the fullest-profile couples. Triple-confirmed (holistic + differential + multipass); differential empirically verified the fake↔real divergence (node:sqlite allows 999). Fix: `chunk()` + `D1_IN_CHUNK_SIZE=90` in `db.ts`, one query per chunk; **made `src/test/fake-d1.ts` throw at 100 params** so the class is provable — the two new 150-id tests fail against the old code with `D1_ERROR`.
- **[significant] Refresh-token path unreachable** (`e6ddd6d`). Session cookie `Max-Age=900` == JWT 15m, so a real browser past that window sends only `mn-refresh`; `authenticateRequest` bailed at `if (!sessionCookie) return null` before the refresh branch, making the 90-day token dead. The existing refresh tests masked it by sending an expired-session + refresh pair no browser emits. Fix: fall through to refresh when the session cookie is absent but a refresh cookie is present; added the browser-realistic test.
- **[significant] Solo detection server vs client** (`1b4f02b`). Server derived `solo` from `group_name === "__solo__"`; client and CLAUDE.md use member count. A one-member regular group (partner not yet joined — the default new-user path) got group-shaped prompts (asking the model for overlap/tension among one person) with solo UI. Fix: derive `solo` from a `COUNT(session_members)` subquery in `getSessionForMember`.
- **[significant/privacy] Rough-day weighting prose leak** (`18c5908`). The single-favored note told the model picks "should lean toward Ben's preferences" while the tone note asks it to name members; in a two-person group the favored member is by definition the non-toggler, so "picks lean toward Ben" reveals to Ben that his partner set rough-day for him — exposing the generosity the feature hides. Fix: keep the favored name in the prompt (needed to apply the lean) but mark it PRIVATE and forbid surfacing it in any output field.
- **[minor] Null JSON body → 500** (`2294d88`). `request.json()` returns `null` for body `null` (valid JSON), escaping the parse try/catch; the validator (called outside it) dereferenced null and 500'd. Fix: reject non-object bodies with 400 across the match, session-create, and profile-PUT routes.
- **[minor] Cron miscount/resubmit** (`9f8ab1c`). `refreshed++` counted queued not committed; a throwing flush left `pending` intact so the next chunk boundary re-submitted a growing batch; the final flush was unwrapped. Fix: clear `pending` before awaiting, count only on commit, count a failed chunk as errors, swallow the throw.

Client (delegated, all TDD, verified real first):
- **TagPicker preset dedupe was case-sensitive** (`6768de1`) — typing `horror` created a custom chip decoupled from the `Horror` preset, sending near-duplicate tags to the prompt. Fix: fold a case-insensitive preset match into the preset's canonical casing.
- **`busy` semaphore vs per-button `disabled` mismatch** (`f25554e`) — an in-flight leave left Create/Join visibly enabled but silently no-op (guard returns on truthy `busy`). Fix: disable every mutation control when `busy !== null`, keeping per-action labels.
- **Session-load failure always claimed nonexistence** (`e66b195`) — `getJson` collapsed 404 / network / 5xx into one null, so a transient blip rendered "this session doesn't exist" with no retry. Fix: discriminated `SessionLoad` — `missing` (the member-scoped 404, existence still indistinguishable) keeps the copy; `error` shows a Try-again affordance.
- **Quick match dropped the private rough-day toggle on group-fetch failure** (`477b2b1`) — `others` became `[]` so the toggle vanished though `groupId` was still sent as a group match. Fix: keep the toggle for a group match even when member details fail to load; flag stays the caller's own.

**Docs (8.5/8.6):** implementation-pitfalls PLAT-1 (D1 param limit + chunk pattern, new "Cloudflare Workers & D1" section) and testing-pitfalls §7 (fake must enforce real limits; fixtures must reproduce states a real client emits) — `7391ab1`. `docs/deploy.md` deploy runbook — `f12e9a4`. CLAUDE.md/AGENTS.md project-layout corrected to the shipped routes.

**Still blocked on credentials (for whoever deploys):** 8.3 live evals (`ANTHROPIC_API_KEY`), 8.4 adversarial injection launch gate (real matching endpoint), 8.2 full OAuth+seed preview. All in `docs/deploy.md`. The `STALE_TITLES_LIMIT=200` Free-vs-Paid decision and the accepted rate-limit TOCTOU races carry forward unchanged.

---

## Session close — handoff + WCAG 2.2 AA target (2026-07-19)

**Handoff doc:** `dev/handoff-2026-07-19.md` — headline state, glossary, priority queue, operational guardrails, and a paste-ready continuation prompt for a fresh session.

**Sam set WCAG 2.2 Level AA as the conformance target.** This resolved the Phase 7 close-out's open question ("promote `slate` borders to `ash`, or accept explicitly") in favor of *must fix* — 1.4.11 is a AA criterion, so "accept" was no longer available. New authoritative doc: **`docs/accessibility.md`** (per-criterion audit + remediation queue). The plan's discovery entry was struck through and redirected there; the target itself was routed into `CLAUDE.md`/`AGENTS.md` so it loads every session.

Measured rather than inherited (WCAG relative-luminance formula, validated against reference pairs — `#fff`/`#000` → 21.00:1, `#777`/`#fff` → 4.48:1):

- **`slate` borders fail 1.4.11** — 1.53:1 on midnight, 1.34:1 on charcoal, vs 3:1. Worse than the ~1.5 estimate carried in the plan. 45 occurrences, 21 files.
- **`ember` on `charcoal` is 4.12:1** — under the 4.5:1 text floor. Only ever used on midnight (4.70:1) today; that was an unwritten invariant living in one reviewer's head, now recorded in DESIGN.md and CLAUDE.md.
- **DESIGN.md's own contrast figures were wrong** — cream stated 13.2:1 (actually 16.52:1), amber stated 7.1:1 (actually 9.04:1). Understated, so nothing shipped badly, but a design system with wrong numbers eventually justifies a bad decision. Corrected, with the method and a recompute-don't-remember note.
- Two further AA gaps found while auditing: **2.4.2** (six client-component pages all inherit the generic `<title>Movie Night</title>`; the fix needs a server `layout.tsx` per segment since a client component can't export `metadata`) and **2.4.1** (no skip link; note `<main>` lives per-page, not in the root layout).
- Verified *passing* so they aren't re-litigated: 2.4.11 Focus Not Obscured (no `sticky`/`fixed` anywhere), 2.5.8 Target Size (44px mandated vs 24px required), 3.3.8 Accessible Authentication (OAuth, no cognitive-function test). 2.5.7 and 3.2.6 are N/A.
- Recorded as **not** verified rather than assumed passing: no screen-reader pass has ever been run, 400% zoom (1.4.10) untested, 3.3.7 unaudited.

**Also corrected a live contradiction:** DESIGN.md's rough-day section still gave `"tonight's picks lean toward [name]'s preferences"` as a safe, anonymous phrasing — the exact leak fixed in code this session (bug #4, commit `18c5908`). In a group of two the favored member is by definition the non-toggler, so naming them tells the recipient. The doc was actively contradicting shipped behavior and would eventually have re-introduced the bug; replaced with the invariant the prompt now enforces.

---

## WCAG 2.2 AA remediation — the three open gaps closed (2026-07-27)

Branch `claude/movie-night-a11y-fixes-fb9122`, off `283b025` (the PR #4 merge). All three items
in `docs/accessibility.md`'s queue are fixed, each TDD, each its own commit, gates green and
pristine at every commit. **563 tests passing, up from 519.**

**1.4.11 control boundaries** (`2f67522`). Resting borders on interactive controls moved
`slate` → `ash`; `slate` kept for dividers, panel edges, hover washes, and disabled controls
(1.4.11 explicitly exempts inactive components). `hover:border-ash` was a no-op once resting
was ash, so those moved to `cream`.

Two things the audit's `border-slate` grep could not have found:
- **`ToggleRow`'s switch track**, a `bg-` utility, not a border. Knob position is the only
  visual carrier of on/off and the off state was slate-on-charcoal (1.34:1) with a midnight
  knob on that track (1.53:1). Now an inset ash ring (5.44:1) + ash knob (4.06:1).
- **`privacy/page.tsx`'s `marker:text-slate`** bullets — surfaced by the allowlist test, judged
  non-governed (list semantics carry the meaning) and allowlisted with that reason.

**2.4.2 page titles** (`5b69073`, `0dd9b5f`). Server `layout.tsx` per client-component segment.
The audit listed six; `groups/join/[code]` was a **seventh** and would have inherited "Groups".
Then a Next.js subtlety worth remembering: **a title template applies only to a segment's
children, and a plain-string title passes none further down** — `groups` setting
`title: "Groups"` left its grandchild with no template, so `/groups/join/[code]` served
"Join a group" with no suffix. Verified against served HTML, not just the metadata objects.

**2.4.1 skip link** (`e79d52d`, `602cede`). `SkipLink` first in `<body>`, `id="main"` on all
**20** `<main>` branches (not 9 — pages return separate branches for loading/error/empty/content).

### The browser pass earned its keep

Three defects survived a green 561-test suite and were caught only in a real browser:

1. **The skip link moved nothing.** A bare `<main id="main">` is not focusable, so activating
   it scrolled while `activeElement` stayed `<body>` — the next Tab went back to the banner the
   user had just asked to skip. Needed `tabIndex={-1}` on all 20.
2. **The focused skip link had no padding.** `not-sr-only` resets `padding` to 0, so the
   unprefixed `px-md` lost the cascade; measured 0 on all sides. All its layout utilities are
   now focus-prefixed.
3. The switch-track gap above, invisible to a border-oriented grep.

### Measurement gotchas (routed into docs/accessibility.md)

- **Composite alpha before comparing.** `--amber-glow` is `#e8a84920`; an amber track against a
  raw translucent panel measured "1.00:1". Walk the tree and composite to a solid first.
- **`:focus` does not match when the browser window lacks OS focus**, even though
  `activeElement` is set — a programmatic `.focus()` in a background pane looks exactly like
  broken CSS. Check `document.hasFocus()` or drive it with a real Tab.
- **jsdom has no layout, no cascade, and no fragment-navigation focus.** This is the third
  session in a row where that produced a false green; it is now stated plainly in the doc.

### Guards left behind

`src/test/contrast.ts` computes WCAG relative luminance with the palette **read live from
`globals.css`**, so assertions track the real tokens instead of a copy — validated against
`#fff`/`#000` → 21.00:1 and `#777`/`#fff` → 4.48:1, and it reproduces every figure in
`docs/accessibility.md`. `control-contrast.test.tsx` renders each primitive and then pins every
remaining `-slate` use to a documented allowlist, so a new slate boundary fails loudly rather
than passing silently.

### Verification performed

`next dev` at 375px and 1280px. These changes are presentation and metadata only, so CF bindings
were not needed; the credential-blocked work (real seed, live evals, injection gate, deploy) is
unchanged and still listed in `docs/deploy.md`. **Not done: still no screen-reader pass, and
400% zoom (1.4.10) remains untested** — both were already recorded as unverified and still are.

### Follow-up worth doing separately

The secondary-button class string is duplicated verbatim in five files. Left alone deliberately
to keep this change to one concern, but it wants extracting.

---

## Outlined control classes extracted to one definition (2026-07-27)

Branch `claude/secondary-button-extract`, stacked on the a11y branch (the strings contain
`border-ash`, which only exists after `2f67522`). Commit `a587a9d`. **569 tests passing.**

Follow-up to the 1.4.11 work, where the same edit had to be applied at five copy-pasted
call sites. Extracted to `src/components/control-classes.ts`.

**The design call that mattered:** two levels, not one. The first cut bundled `rounded-control`
into the shared constant — and the new anti-duplication guard immediately failed on `chip.tsx`
and `group-picker.tsx`, which use `rounded-pill` and `rounded-panel` and had therefore
re-spelled `border-ash … hover:border-cream` by hand. **Bundling shape (a per-control design
choice) with the boundary (a conformance requirement) is what created the duplication in the
first place.** Split into `outlinedBoundaryClasses` (border + hover, no radius) and
`outlinedControlClasses` (adds radius/border/label color). Real count was eight sites, not five.

**Class strings, not a `<Button>` component.** Call sites are a mix of `<button>` and `<Link>`
(`tonight/page.tsx:90` is a Link), and several append their own modifiers. A component would
need polymorphism plus a class-merge dependency to say the same thing — YAGNI.

**Tailwind ordering trap, recorded in the module's doc comment:** conflicting utilities resolve
by *stylesheet* order, not class-attribute order, so `${compactOutlinedButtonClasses} px-lg` is
undefined behavior. The groups submit button composes from `outlinedControlClasses` and supplies
its own padding instead. This was caught while writing it, not after.

**Verified as a refactor, not a redesign.** Compared the resolved class *set* at every call site
against `git HEAD`: identical everywhere, with one deliberate exception — tag-picker's Add button
gains `transition-colors duration-100`, which the secondary button beside it in the same row
already had. All nine routes still render 200 with no `undefined` in any class attribute.

**Noted, not done:** the primary (amber fill) button is duplicated across **twelve** sites — more
than the secondary was. Left alone to keep this commit to one concern; it wants the same treatment.

---

## Primary button classes extracted to one definition (2026-08-01)

Branch `claude/primary-button-extract`, commit `dff9ca5`. **575 tests passing** (569 + 6 new).

The follow-up the previous entry named. The amber-fill CTA was spelled out verbatim at
**twelve** call sites across nine files — `page.tsx`, `quick` (x2), `groups`, `groups/join/[code]`,
`results`, `profile`, `tonight`, `ritual` (x3), `refine-panel`. The grep found exactly the twelve
the handoff predicted, which is the first time a duplication count has been right on the first try.

**Same two-level split as the outlined treatment, for the same reason.** `primaryFillClasses` is
`bg-amber text-midnight hover:bg-warm-white` — the fill, the label colour its 9.04:1 contrast is
measured against, and the hover. Changing any one of the three without the others is the failure
mode, so they are one indivisible string. It carries no radius, size, or display, because two of
the twelve sites disagree on exactly those: the landing CTA is `inline-flex` with no
`justify-center`, and the groups form button is 44px with `px-lg` to sit beside a 44px input.
Both compose from `primaryControlClasses` (fill + radius + transition). The other ten use
`primaryButtonClasses`, the 48px flex button that counterweights `secondaryButtonClasses`.

**Four different disabled treatments are in play, and they stayed at their call sites.** This is
the one finding worth Sam's attention:

| Site | Disabled treatment |
|------|--------------------|
| `groups:226`, `groups/join/[code]:11` | `disabled:opacity-50` |
| `ritual:337` | `disabled:opacity-60` |
| `profile:27` | `disabled:bg-slate disabled:text-ash` |
| `refine-panel:111` | `disabled:border-slate disabled:bg-transparent disabled:text-ash` |
| the other six | none at all |

`opacity-50` vs `opacity-60` in particular reads as a typo rather than a decision. Normalising
them is a design call, not a refactor, so nothing was touched — but the primary CTA now looks
disabled four different ways depending on which screen you are on. DESIGN.md does not specify a
disabled treatment, which is probably the root cause.

**Appending `disabled:` variants is safe; appending base utilities is not.** Tailwind generates
`.disabled\:bg-slate:disabled`, whose specificity beats `.bg-amber` regardless of stylesheet
order, so `${primaryButtonClasses} disabled:bg-slate` is well defined. `${primaryButtonClasses}
px-lg` would not be — hence the groups button composing from the control level instead. This is
the same trap recorded on `compactOutlinedButtonClasses`; the module's doc comments now say it
in both places.

**Verified as a refactor, not a redesign.** Reconstructed the composed string at each of the
twelve sites and compared the resolved class *set* against `git HEAD`: identical at all twelve,
with no exceptions this time. The `-slate` allowlist in `control-contrast.test.tsx` is unchanged,
which independently confirms `profile` and `refine-panel` kept their disabled boundaries.

**Guard.** `control-classes.test.ts` gains two anti-duplication cases (the `bg-amber px-xl`
string, and the `bg-amber … hover:bg-warm-white` pair that catches a near-copy at a different
size), plus four assertions pinning the split. The four filter blocks across the outlined and
primary guards now share one `callSitesSpelling(pattern)` helper rather than being copy-pasted
a third and fourth time.

---

## Person-color contrast sweep — the taste-map colors closed out (2026-08-01)

Branch `claude/a11y-verification`. **607 tests passing** (was 569).

Closes the "spot-measured, not swept" item in `docs/accessibility.md` §Not yet verified. Test
first: `src/components/person-color-contrast.test.tsx` enumerates every real (foreground,
composited background) pair for `person-a`…`person-d` and `overlap`, each asserted at the
threshold its role carries — 4.5:1 for the 12px tag labels, 20px member headings and 16px
landing copy, 3:1 for the legend swatches and section rules.

**Everything passes.** All five land on exactly one opaque backdrop, `midnight`, because every
surface that uses them renders in a bare `<main>` with no panel between it and `body`: 5.59 /
6.10 / 7.34 / 7.27 / 5.54. The one composited pair is the selected dealbreaker chip, whose
`#ce7b8c20` fill flattens to `#271f27` — label 5.21:1, border 6.10:1 against the page.

**`composite()` added to `src/test/contrast.ts`**, since the compositing trap from the
2026-07-27 pass had no code behind it. Source-over flattening of `#rrggbbaa` over an opaque
backdrop, with a test that reproduces the trap itself (amber against raw `amber-glow` measures
<1.05:1; against the flattened panel, >3:1).

**The sweep is only a sweep if the enumeration is complete**, so the test pins the files allowed
to paint a person color to an allowlist (the slate-allowlist pattern from `control-contrast`),
counting Tailwind utilities, `var(--token)` reads *and* raw hex — the chip fill is written
`bg-[#ce7b8c20]`. A second guard asserts nothing outside `taste-map.tsx` imports `personColor` /
`PERSON_COLORS`, which would otherwise paint these hues on an unmeasured surface without moving
any count.

**Two near-misses found, both pinned as constraints rather than fixed** (nothing violates them
today): the rose chip on `charcoal` would be 4.45:1, and `overlap` on an `amber-glow` wash is
4.49:1. Both are in DESIGN.md §Accessibility beside the `ember`/`slate` rules.

**The amber-wash one was checked in a browser, not argued.** The landing hero paints an
`amber-glow` ellipse anchored at the top edge; whether it reaches the person-colored vignette is
a layout question jsdom cannot answer. Measured the real gradient box and span rects at 375px and
1280px: the ellipse fades out at y≈263 / y≈235 while the colored spans start at y≈434 / y≈432, so
the alpha under them is zero at both widths.

## 3.3.7 Redundant Entry audited in code (2026-08-01)

Branch `claude/a11y-verification`. **609 tests passing.**

The last un-audited "believed to pass" item. It does pass, and for the assumed reason: the ritual
loads the saved profile into step 0 (`ritual/page.tsx:75`, `:91`, `:251`) with tmdb ids resolved
back into named title chips (`session-flow.ts:65-90`), writes it back on Continue (`:132`), and
asks the other members for nothing at all (`:269`). Choices carry across steps rather than being
re-asked: the group travels in the URL from `/tonight`, and an invite code survives the OAuth
round trip (`groups/join/[code]/page.tsx:113`).

**The failure paths were the part actually worth checking**, and they hold: the match-error screen
keeps the mood you entered rather than resetting the step, and the results page clears the steering
box only on a successful round (`results/[sessionId]/page.tsx:130-137`). Both are now regression
guards in `ritual/page.test.tsx` — stepping back and forward, and returning from a failed match —
because they are behaviors nothing else would notice losing. `advanceToMood` moved to module scope
to be shared rather than copied.

**Honest boundary, recorded in the doc:** in-progress mood answers are React state only, so a
reload mid-ritual starts the mood step blank. Read as a restarted process rather than a redundant
step within one — but that is a judgment about where a process begins, not a measurement.

## 1.4.10 Reflow — partial verification recorded (2026-08-01)

Browser pass at 320 CSS px (the 400%-zoom equivalent), report in
`dev/reports/2026-08-01-reflow-400pct.md`. Signed-out surfaces pass with zero overflowing
elements, measured by a full-DOM `getBoundingClientRect()` sweep rather than by eye.

**Recorded as half done, not closed.** `next dev` has no Cloudflare bindings, so `/api/auth/me`
500s and all six auth-gated routes take their signed-out redirect before rendering anything. The
chip grid, results tablist and taste map — the densest layouts in the app, and the ones most
likely to overflow at 320px — were never on screen. Finishing it needs a signed-in session under
`npm run preview` or the deployed app, which is the same blocker the screen-reader pass has;
the doc now says so in one place.

## CLAUDE.md / AGENTS.md audited against the codebase (2026-08-01)

Line-by-line audit of every factual claim in the agent-guidance files, each one checked against the
tree rather than against memory. The seeded-from-another-project boilerplate was already largely
gone; what remained were claims that had drifted as the stack moved.

**Two claims were actively wrong in a way that could mislead.** The Tech Stack table listed
Cloudflare Workers KV — there is no `kv_namespaces` block in `wrangler.jsonc` and no `KVNamespace`
reference anywhere in `src/`, so the row invited a binding that does not exist. And Deploy claimed
"GitHub Actions → OpenNext build → wrangler deploy"; `.github/workflows/` contains only `ci.yml`,
which has no deploy job. Deployment is the manual `npm run deploy` documented in `docs/deploy.md`.

**The rest was drift.** Framework/language versions lagged two majors (`next ^16.2.10`,
`typescript ^6.0.3`); `npm run lint` is `eslint .` under a flat config, not `next lint`; the env
binding list named three of seven `CloudflareEnv` members, omitting `DB`, `ANTHROPIC_API_KEY`,
`TMDB_API_TOKEN` and `MONTHLY_MATCH_LIMIT`; the data model listed 11 of the migration's 13 tables,
missing `sessions` and `rate_limit_log`; the test glob omitted `.tsx` and `scripts/`; and the cron
paragraph described only half of what `runWeeklyRefresh` does, with no schedule attached to
"runs weekly" (it is `0 9 * * 1`, top-200-by-popularity, batches of 25).

The two limits on matching now say where they live — both are enforced in the match route, not in
`matching.ts`, which is where you would look first and not find them.

`AGENTS.md` was regenerated from the corrected `CLAUDE.md` through the seven known
framework-phrasing substitutions, so the sibling-sync invariant is mechanical rather than manual.

Docs-only: CI's `paths-ignore` covers `**/*.md`, so no jobs run for this change. That fact is now
written into the CI paragraph, since "no checks" on a docs PR reads as a failure otherwise.

## First performance audit — pre-deployment baseline (2026-08-01)

Full report in `dev/reports/2026-08-01-performance-audit.md`. No application code changed;
`tsc --noEmit`, `eslint .` and `vitest run` (59 files, 615 passed, 2 skipped) all clean.

**The point of the audit, in one line:** at this app's data scale SQL execution time is
irrelevant and the number of *sequential D1 round trips* is everything. The heaviest query in the
codebase runs in 0.095 ms against a 1,000-title catalog; the most expensive path issues up to 20
of them one after another. Nothing in `src/lib` or `src/app/api` ever runs two D1 reads
concurrently — `db.batch` is used correctly for writes and never for reads, and there is no
`Promise.all` in any handler. That costs nothing on localhost and will be the largest source of
production latency once real network round trips replace in-process calls.

**What could not be measured, and why it matters.** Nothing is deployed, so every number is
localhost. No Anthropic or TMDB credentials, so the match path's 1–4 model calls and the cron's 200
TMDB fetches are counted, not timed — and the Anthropic call dominates the match path's latency
profile. Worker startup time only comes from a real `wrangler deploy`; local first-request latency
is miniflare bootstrap and is not a valid proxy. FCP/LCP were discarded: a concurrent agent held
the browser foreground, so the tab was backgrounded and Chrome deferred rendering (first-paint
3,084 ms against DCL 88.7 ms). Resource Timing, render-blocking classification and font-load status
are visibility-independent and were kept. All of this is listed explicitly in the report's §1.4
rather than buried.

**Seed data is synthetic.** `npm run seed:local` needs a TMDB token, so a 1,000-title catalog was
generated to match what `DEFAULT_PAGES = 50` produces, plus full 50+50 profiles, 41 sessions and 49
recommendations with realistic ~5 KB `ai_response` blobs. A separate 20,000-title / 50,049-
recommendation probe answered "which of these degrades". An earlier version of that probe attached
all 50k recommendations to one session and produced two alarming numbers that were artifacts of an
impossible distribution (`MAX_ROUNDS_PER_SESSION = 10`); the report records the false alarm so a
future audit does not re-derive it.

**Findings that were not on anyone's list.** Content-hashed `/_next/static/*` assets are served
`Cache-Control: public, max-age=0, must-revalidate`, so every repeat visit revalidates ~14
immutable files — the fix is a three-line `public/_headers`, but it is asserted against
`wrangler dev` and must be re-checked against the first real deploy. `Satoshi-VariableItalic.woff2`
(43,844 B, 18.6% of the font payload) is preloaded on every page for exactly one italic `<dd>` in
`mood-screen.tsx:141`. There is no `preconnect` to `image.tmdb.org` even though the results page
is entirely third-party posters, and pick #1's poster — the results page's LCP element — is
`loading="lazy"`.

**Index review found one gap and no surprises.** `countMatchesThisMonth`
(`movie-sessions.ts:141`) is the only unindexed predicate on a hot path: `SCAN recommendations`,
executed on every match request, on a table that only grows. Measured 0.004 ms at 49 rows and
38.0 ms at 50,049; a `created_at` index takes it to 0.180 ms, verified by re-planning and
re-timing. Proposed, not written — no migration in this change. `idx_movie_sessions_group` serves
no read in Phase 1 (it backs the `groups` CASCADE that bug B14's fix would start using), and the
implicit PK/UNIQUE indexes carry more load than the explicit ones, correctly.

**Live confirmation of B7.** While setting up the match-path measurement, `MONTHLY_MATCH_LIMIT=0`
was written to `.dev.vars` on the assumption it disables matching. `wrangler dev` does not
hot-reload `.dev.vars`, so one request went the whole way to `api.anthropic.com` and came back
`401 invalid x-api-key` — no tokens, no cost, and the "key" was the literal string
`not-set-do-not-call`. The kill switch is unarmed exactly as B7 says. A restart with
`MONTHLY_MATCH_LIMIT=1` produced the intended `429 monthly_cap` in 3.7 ms with no external call.
Secondary observation: an Anthropic 401 is outside `MATCHING_ERROR_HTTP`'s taxonomy, so a revoked
key surfaces as a generic 500 with no distinct signal.

**Bundle numbers, recorded as the baseline to diff against.** Worker upload 5231.68 KiB raw /
1122.74 KiB gzip — 11% of the Paid 10 MiB limit, so size is not a concern; ~92% of it is Next.js
and React, and the project's own source compiles to roughly 30 KB. Client shared JS 623,862 B raw /
184,840 B gzip, dropping to 511,268 / 145,213 for modern browsers once the `noModule` polyfill is
excluded. One render-blocking resource, a 7,140 B gzip stylesheet. The heaviest route
(`/ritual`, 13,026 B gzip of route-specific JS) is 8 KB above the lightest — there is no
code-splitting problem, and no route is disproportionate. Next 16 + Turbopack no longer prints the
per-route size table, so these were recovered by parsing the prerendered HTML, which is what a
browser actually fetches.

Ranked recommendations are in the report's §7, split into fix-before-launch, worth-doing, and
matters-only-at-scale, with the items already owned by the Phase 1 remediation plan (D7, D2, D3,
B6/D6, B7, B12) referenced rather than re-specified.

Docs-only: CI's `paths-ignore` covers `**/*.md`, so no jobs run for this change.

## Authenticated 1.4.10 verification, unblocked by a local session (2026-08-01)

The 1.4.10 gap was an environment problem, not a layout problem, and the fix was to stop
needing OAuth. `authenticateRequest()` only wants a JWT signed with the Worker's own
`JWT_SECRET`, or a `sessions` row whose `token_hash` is the SHA-256 of the `mn-refresh`
cookie — both manufacturable locally. A `.dev.vars` with a made-up secret, `npm run migrate:local`,
fixture rows inserted straight into local D1, and a JWT minted by importing the project's own
`createJWT` (so the claims cannot drift from what verifies them) puts a real signed-in session
in front of `wrangler dev`. `/api/auth/me` returning the seeded user was the gate before any
measurement was taken. Written up as a runbook in
`dev/reports/2026-08-01-authenticated-a11y-verification.md`, because it also unblocks the
screen-reader pass — that one still needs a human with VoiceOver, but no longer needs a deploy.

**Every authenticated route reflows cleanly at 320px.** `/profile`, `/groups`, `/tonight`,
`/quick`, all three `/ritual` steps, all three `/results` tabs, and the signed-in branch of
`/groups/join/[code]`: `scrollWidth === clientWidth === 320`, zero overflowing elements, zero
horizontally-scrollable subregions. The three surfaces that were the reason to care are fine —
the 30-chip grid wraps with 27px to spare and does not grow when selection adds `font-medium`,
the results tablist fits one row, and the taste map has no SVG or canvas at all, so 1.4.10's
2-D exception never applies anywhere in the app.

**Two real content losses, left unfixed and documented as open.** No horizontal scrolling, so
they are not the failure anyone was looking for — but `truncate` clips text with no scrollbar
and no `title`, which a `scrollWidth` check walks straight past. Catching them needed a separate
sweep for `text-overflow: ellipsis` with `scrollWidth > clientWidth`. The `/groups` invite link
loses 79px, about a quarter of the URL, and the comment above `copyInvite` justifies the
clipboard-failure path on the grounds that the link is rendered in full — which stops being true
below roughly 400px, exactly when a user is most likely to be on a phone. `/tonight`'s member
list loses 43px and matters less.

Three traps worth remembering. Seeded `titles.streaming` must be `StreamingInfo`
(`flatrate: string[]`), not TMDB's raw `[{provider_name}]`, or the picks tab renders
`On [object Object]`. Sibling agents in other worktrees share the port range, the scratchpad and
the Browser pane — an unnamespaced log and the default 8787 got clobbered mid-run, and a sibling's
tab stole the viewport size, so ports and log names need namespacing and `tabId` needs passing
explicitly. And chip screenshots were captured with `playwright-core` installed into a scratch
directory against the already-cached Chromium, so nothing was added to the project's dependencies.

## 2026-08-01 — Phase 1 bug-hunt remediation plan (docs only, no code)

Turned the consolidated bug hunt (B1-B15, D1-D7), two independent Opus sanity reviews, the
performance audit and the authenticated-a11y verification into one subagent-proof implementation
plan plus a durable decision record. **35 tasks across a prep group and seven execution groups**,
merge order `PREP → G1 → G4 → G7 → G6 → G2 → G3 → G5`. No source files were changed.

**Platform facts checked against the live Cloudflare docs and the installed SDK, not memory**, and
they overturned one decision outright. The 1,000-subrequest limit was removed on 2026-02-11: Paid
now defaults to 10,000, and the Free plan's 50 applies to *external* subrequests only, with a
separate 1,000-call budget that D1 draws on. Every argument for dropping `STALE_TITLES_LIMIT` to 40
rested on the obsolete numbers, and the real Free-plan blocker is 10 ms CPU, which this app cannot
fit under at any limit. It stays at 200; the stale comment and `docs/deploy.md` get corrected
instead. Also verified: `db.batch()` is a real transaction (load-bearing for B1/B4 and for keeping
D4's prune *out* of a batch), D1 enforces foreign keys by default (load-bearing for B15's
statement sequencing), and the Anthropic SDK's default timeout is 10 minutes which it *scales up*
for large `max_tokens` and *retries* — so D3's tail today is tens of minutes, not the 20 the report
estimated, and the fix is one constructor option because `APIConnectionTimeoutError` already
extends the class `callClaude` maps.

**Three adversarial review rounds** — one self-review, two by fresh agents with no conversation
history who verified every citation against source. They found four blockers that were substance,
not wording, and all four are the same shape: a fix that is correct about the bug and quietly wrong
about something else. B1's grace check would have read `rotated_at` from *before* the claim, which
is `NULL` in the real race, so the loser still 401s — and the only test the synchronous fake D1
permits passes either way. B1's two claim statements had mismatched predicates, so an expiring row
could mint a cookie for a session that was never inserted. B5's scrub, as the security review
specified it, ran a literal replacement over the *serialized* JSON: it matches JSON keys (a user
named `name` or `summary` corrupts the document), every member's name rather than the deleted one's,
and film titles inside the survivor's prose — now scoped to four named parsed fields with a
same-name suppression rule. And B6's failure-path attempt stamp would have ridden D6's `refreshed`
counter, making a run where every fetch failed log `refreshed: 200` — the exact lie D6 exists to
remove, in the same commit that removes it.

**One deliberate deviation from the reconciled decisions, flagged for override.** B8 was to show
the weighting note "only when weighting actually applied". That cannot be done without a leak: the
toggler knows their own flag, so a note whose presence tracks "weighting applied" is a direct
readout of whether their partner also toggled. Truthfulness-about-the-engine and the privacy
invariant are in genuine conflict. Rather than suppress the note, the plan removes the *claim* —
rewording it to describe the user's own choice, which is what `DESIGN.md:124` says the note should
have been all along. No `SessionView` change, no leak, no falsity.

**Two premises corrected.** `migrations/` holds only `0001`; the `0002_auth_schema.sql` both
reviews assumed was stale `CLAUDE.md` boilerplate. Since B1 needs a migration too, the allocation
is `0002`→B1, `0003`→B6, `0004`→the audit's indexes — so B6 still lands on the number the reviews
named, for a different reason. And `docs/deploy.md` §2 is headed "✅ DONE", so three pending
migrations appended under it would be skipped by a deployer; the first group to touch the file now
creates an explicit *Pending migrations* subsection. Production without `sessions.rotated_at` would
turn every token refresh into a 500.

Artifacts: `dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md` (the what),
`dev/research/2026-08-01-remediation-decisions.md` (the why, including where the two reviewers
disagreed and how it was resolved), and the two sanity reviews they were reconciled from.

## G7 — Pre-launch performance quick wins (2026-08-01)

The performance audit's five Tier A/B quick wins, from
`dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md` §8a. Immutable cache headers for
content-hashed assets, the Satoshi italic preload, a preconnect to the poster origin, an eagerly
fetched first poster, and `migrations/0004_recommendation_indexes.sql`. **Merge classification:
Review — schema migration.**

**Two of the plan's five premises did not survive verification.** Both tasks still ship — the code
is right — but the reasons given for them were wrong, and the wrong reasons had been written into
source comments where they would have outlived the PR. They are recorded below rather than quietly
corrected.

**The plan's preconnect spec was wrong, and the correction is the headline.** G7-3 mandated
`<link rel="preconnect" href="https://image.tmdb.org" crossOrigin="" />`, justified by "the poster
`<img>` requests are anonymous-CORS-mode by default". That premise is inverted, and the attribute
would have defeated the hint it was added for. Measured in a browser against the real origin:
a plain `<img src>` loads (`naturalWidth` 342), the identical URL with `crossorigin="anonymous"`
fails (`naturalWidth` 0), `fetch(url, {mode:"cors"})` throws `Failed to fetch`, and `curl -I`
returns no `Access-Control-Allow-Origin` — `image.tmdb.org` (BunnyCDN) does not support CORS at
all. `Poster` renders a bare `<img src>` with no `crossorigin` attribute, so poster requests are
necessarily no-CORS. Browsers pool CORS and no-CORS connections separately, so the specified hint
would have warmed a socket the posters can never reuse: DNS shared, but the TCP + TLS handshake —
the 2 RTTs the task exists to remove — paid again on the critical path. **Resolved: ship without
`crossOrigin`.** An independent adversarial review reached the same conclusion from the spec side
before seeing the measurements. The reason is now a comment on the `<link>` and an assertion in
`layout.test.tsx`, because a bare `crossorigin`-less preconnect reads like an omission and is
exactly the kind of thing a later reader "fixes" back.

Its real beneficiary is also not the results page. The hint helps whichever surface requests a TMDB
image first, which in practice is `TitleSearch`'s `w92` thumbnails on `/profile`
(`profile-editor.tsx:76,88` → `title-search.tsx:147`). On the prerendered routes that never request
one it warms a connection nothing uses, and Chrome drops an idle preconnected socket after ~10 s —
a real but small cost, and the reason the hint is not worth widening to other origins.

**The eager first poster is not an LCP fix, and the plan's claim that it is does not survive
reading the results page.** `results/[sessionId]/page.tsx:78` defaults the tab to `"map"`, and
`RankedList` mounts only under `tab === "picks"` (`:352-358`). No poster is in the DOM at first
paint, and LCP stops accepting candidates at the first user interaction — so pick #1 cannot be the
LCP element there under any network condition. The change still earns its place: the first poster
is the one read first, and fetching it eagerly stops it queueing behind its four siblings, so the
picks paint sooner **after** the tab click. Both source comments now say that, because "this is the
LCP element" is the kind of assertion a later reader would trust rather than re-derive. Whether the
picks tab should be the default is a design question and out of scope here.

**G7-1 landed with better evidence than expected, and one honest gap remains.** Under
`wrangler dev` against the built worker, `/_next/static/chunks/*.js` and
`/_next/static/media/*.woff2` both return `public, max-age=31536000, immutable`, `/` keeps its
`s-maxage=31536000`, and `/_headers` 404s (parsed as config, never served). So the file parses, the
splat covers chunks and fonts, and nothing outside `/_next/static/*` moved. **Still unverified:
production's default.** The `max-age=0, must-revalidate` this corrects was only ever observed under
`wrangler dev`, so whether the fix was needed at all is what the `curl -I` step added to
`docs/deploy.md` §Post-deploy verification settles. A miss there would be a platform difference,
not a syntax error. There is no unit test — a `_headers` file has no in-process behaviour this
stack can assert on; the guard is the build-output check plus that deploy step.

**G7-2.** Dropping the italic `src` entry takes 43,844 bytes (18.6% of the font payload) off first
load, for a face the whole app rendered in one place. Font preloads went 4 → 3 and `document.fonts`
now registers `satoshi` normal only; next/font no longer emits a hashed copy under
`_next/static/media/`. **It is not removed from the deploy:**
`public/fonts/Satoshi-VariableItalic.woff2` is still copied to `.open-next/assets/fonts/` and
uploaded — 43 KB now referenced by nothing. Deleting it is a separate decision. The preload premise
also needs narrowing: next/font preloads declared faces on the **7 prerendered** routes, not
literally every route — the 2 dynamic ones carry no font preloads at all (`/results/[sessionId]`
serves zero, verified under `next start`). Confirmed independently that every other `italic` in
`src/` carries `font-display` (Fraunces), whose two faces are both in use and untouched.

This is a delivery change, not a type change: `mood-screen.tsx:141` keeps its `italic` class and
still renders slanted, via a synthesised oblique. A/B'd at 375px against the unmodified file —
identical 343x20 box, imperceptible at `text-sm text-ash` on one line. **Caveat: the mood
confirmation screen is behind Google sign-in and unreachable locally**, so that comparison
exercised the real font stack and utility classes on a reachable page, not that screen.

**G7-5's numbers are the audit's; the plans were reproduced locally.** `countMatchesThisMonth` went
`SCAN recommendations` → `SEARCH ... USING COVERING INDEX idx_recommendations_created_at`,
`getRoundNumber` stayed covering through the widened composite, and the results page's
`USE TEMP B-TREE FOR ORDER BY` disappeared. Not oversold: at Phase 1 volume this saves 4
microseconds, and 50,000 recommendations means ~$2,000 of Anthropic spend. It is worth doing
because it is a one-line schema change with no behavioural risk on the most expensive request in
the app, and nothing prunes the table. Verified independently that nothing selects `movie_sessions`
by `group_id` and that no code path anywhere deletes a `groups` row, so `idx_movie_sessions_group`
backed neither a read nor a cascade. **The authority for that drop is the plan and the decision
record, not the audit** — audit §3.1 explicitly says to *keep* the index ("it's cheap and B14 will
use it"), and §3.4's proposals do not include the drop. That hedge assumed B14's fix would start
deleting groups; the decision went the other way, because deleting a group cascades away an
ex-member's history, so the fix became a copy change and the row is never deleted. The migration
header now carries that provenance and tells a later author to restore the index if they ever add
a `DELETE FROM groups`. No test asserts on `EXPLAIN QUERY PLAN`: the planner's output is
version-dependent and pinning it fails on a Node upgrade for no defect.

**Sequencing note.** PREP has not landed, so `loadMigration()` still hardcodes `0001`; the index
tests apply `0004` on top of it explicitly. Every statement is `IF [NOT] EXISTS`, so that stays
correct once PREP generalises the loader — and a test pins the re-apply case, including that the
drops stay dropped. `docs/deploy.md` §2 had no `Pending migrations` subsection to append to (§1.4
assigns creating it to G1, which had not merged), so G7 created it with `0004` alone; G1 and G4
append `0002` and `0003` on rebase, resolved by keeping all three in numeric order.

**Local schema drift, documented rather than coded around.** `migrate:local` and `loadMigration()`
both read `0001` only, so between this merge and PREP's a local D1 — and anything built on it,
including `npm run seed:local` — carries the initial schema and none of the later migrations.
Generalising the loader here would collide with PREP-2, so `docs/deploy.md` §2 states the gap and
gives the exact `wrangler d1 execute --local` command instead. Three statements in `CLAUDE.md`
(`migrate:local`'s description, "13 tables … all from the single migration", and the `migrations/`
line in the project layout) described a one-file migrations directory and no plan task owned them;
they now describe a numbered, hand-applied sequence. `docs/deploy.md` §2's heading was likewise
`Apply the schema — ✅ DONE` for a directory that is no longer one file; the ✅ now names `0001` and
points at the pending list.

**The explicit `<head>` in the root layout was removed on review.** Next 16's layout reference says
not to hand-add one (the Metadata API owns that element and its streaming and de-duplication), and
React 19 hoists `<link>` into head from anywhere in the tree. Verified rather than assumed: the
emitted `<head>` of a prerendered route is byte-identical with and without the wrapper once
build-specific chunk hashes are normalised — 20 tags either way, preconnect at index 15 in both —
and under `next start` the streamed dynamic routes `/results/[sessionId]` and
`/groups/join/[code]` both carry the preconnect in `<head>`. The hint lands after the stylesheet
and the async scripts in every case, wrapper or not.

**Two adversarial review passes** over the complete group diff, both by agents with no
conversation history, and both worth their cost: between them they produced **two blockers, and
both were defects in the plan rather than in the code** — the preconnect's inverted CORS premise
and the claim that pick #1 is the results page's LCP element. Neither was catchable by reading the
diff alone; the first needed the origin's real CORS behaviour and the second needed the results
page's default tab. Also fixed from their findings: a `crossorigin` presence-not-value assertion, a
test name claiming a networking property the harness cannot observe, a regex anchored on the wrong
attribute, an under-asserted migration re-apply case, a `docs/deploy.md` claim about migrations
this branch cannot see, an inverted citation crediting the audit for a drop it argued against, a
measurement presented as this change's rather than the audit's, and three stale `CLAUDE.md`
statements no task owned. Gates pristine at every commit: `tsc` silent, `eslint` silent,
**59 files / 627 passed / 2 skipped** (615 baseline + 12), the three documented
`vite:dynamic-import-vars` warnings and nothing else, plus `@opennextjs/cloudflare build`.
## 2026-08-01 — G5: picker limits, the mood back-edge, and the two open AA failures

Branch `claude/rem-g5-ui`, four tasks from §8 of the remediation plan. Rebased onto `dev` after G7
landed, so the baseline is G7's **627 passed / 2 skipped** → **676 passed / 2 skipped**, +49 tests
across 60 files. `npx tsc --noEmit`, `npm run lint`, `npm test` and `npx opennextjs-cloudflare
build` all clean.

**B10 — the pickers now enforce the counts the server enforces.** `TagPicker` and `TitleSearch`
capped tag *length* but never entry *count*, so the reported path — select all 30 presets (16 mood
+ 14 genre, exactly `MAX_TAG_LIST_ENTRIES`), then add one custom tag — built a 31-entry payload and
took a hard 400. Both take a `max` prop and refuse the tap with an `aria-live` explanation, copying
`/quick`'s 3-tag pattern rather than inventing one; deselecting always works and clears it. The
five render sites pass the endpoint's own ceiling explicitly — a shared `src/config/limits.ts`
would have been imported by four groups' files and turned a two-component change into a cross-group
refactor.

**B11 — the mood back-edge starts a fresh session.** The plan's stated test ("assert `startSession`
was called twice") **passes against the unfixed code**, because `submit()` already calls
`startSession` unconditionally. The bug needs a sharper probe. The reachable defect is that
`sessionId` survives the back-edge, so when the *resubmit's* session create fails, "Try again"
falls back on the first session and re-runs the mood the user just abandoned — `mood_vibes` /
`mood_text` / `discover_new` are written once at creation and never updated. That is the test that
was written, and it fails on unfixed code with `POST /api/movie-sessions/s1/match`. Orphaned
zero-round rows are accepted debris, documented at both handlers; no cleanup was built.

**WCAG 1.4.10 — both open AA failures closed, and verified in a browser.** `docs/accessibility.md`
goes **2 → 0**. The invite link takes `break-all` (matching `groups/join/[code]`'s treatment of the
raw code); the member list takes unbounded `break-words` rather than the `line-clamp-2` the report
suggested first — a clamp still discards what does not fit, which is the same information loss
under a different mechanism. Re-measured per element on a signed-in `wrangler dev` build via the
Part 1 runbook: invite link 236/315 → 236/236 at 320px, 291/291 at 375px; member list 43px lost →
190/190 at 320px, 233/233 at 375px. Also checked against a production-length origin and an
80-character one (0 clipped, three lines), a four-long-name group (0 clipped, four lines, row
140px against the 44px minimum), and a 55-character unbreakable token — that last one is why
`break-words` and not bare wrapping, which would have overflowed the box.

**The methodological point is the durable part.** Three prior reflow passes reported these routes
clean because they compared the *document's* `scrollWidth` to its `clientWidth`. `truncate` clips
with no scrollbar and no document overflow, so that check cannot see it; the sweep has to walk
every node for `text-overflow: ellipsis` with `scrollWidth > clientWidth`. And **jsdom cannot prove
either fix** — no layout engine, so `scrollWidth` and `clientWidth` read 0 for every element. The
unit guards are className assertions and say so in a comment pointing at the runbook. Anyone
tempted to "strengthen" them into geometric assertions will get a test that passes on anything.

**Which of the new tests actually discriminate was answered empirically, not asserted.** A throwaway
copy of the tree, each production hunk reverted in turn, suite re-run, copy destroyed. That is what
caught the three findings worth the most here. **The plan's own mandated B11 test is a no-op** —
"assert `startSession` was called twice" holds either way, because `submit()` calls it
unconditionally; the discriminating probe is a *failed* create after the back-edge, which falls back
on the abandoned session. **The 1.4.10 guards were a one-word denylist** — re-clipping the invite
link as `overflow-hidden text-ellipsis whitespace-nowrap`, or the member list as `line-clamp-1`
(excluded `line-clamp-2` but not the strictly worse `line-clamp-1`), left the suite green; the check
now goes through `src/test/clipping.ts` and both spellings fail. **And reverting
`profile-editor.tsx` and `mood-screen.tsx` entirely also left it green** — five of the six render
sites the plan named were untested. Ceiling tests now exercise them through the composed
components, which catches a picker wired to the wrong list's ceiling and the value drifting from
the endpoint's; **it does not pin the prop, and cannot.** Every explicit `max` equals the
component's own default, so deleting all five changes no behaviour and fails nothing. The only
fix that would pin them is making `max` required, and §8 G5-1 specifies `max?: number` with a
default — so the limit is recorded here and in the tests' comments rather than designed around.
Tests that hold on both sides of a fix are labelled as such where they exist, so the suite does
not overstate itself.

**That finding arrived the hard way.** The review that produced it reverted those two files inside
the worktree rather than a copy and left the reversion staged; the next commit swept it up, and
the suite stayed green through all of it — which is precisely the claim being made, demonstrated
by accident. Restored in a named commit. The lesson is `git status` before every `git add`, even
when the command names explicit paths, because the index can hold work that is not yours.

**Review rounds.** Four, three by fresh agents with no conversation history. Findings acted on: the
a11y record's "zero remaining ellipsis-clipped elements" claim covered only the two routes actually
swept, while `/ritual` still carries a `truncate` the same section says to leave alone — a future
sweep trusting it would read a real clip as a regression; two table cells implied measurements that
were not taken; and four test comments narrated the defect in the past tense against CLAUDE.md's
rule on temporal comments. Cleared as false alarms: `text-ember` on the new live regions is painted
on `midnight` (4.70:1) at every render site, not `charcoal` (4.12:1) — traced to `body` rather than
assumed from the class list; and `break-all` / `break-words` were confirmed to emit under the
installed Tailwind 4.3.3 rather than taken from memory.

**Found in passing, out of scope, flagged not fixed.** `PUT /api/user/profile` carries a *second*
cap the client still cannot see: `MAX_UNKNOWN_IDS_PER_PUT = 10` (`route.ts:14`, `:128`), counted
over the deduped union of both title lists against the local catalog. Since the search endpoint
merges TMDB results, adding 11 catalog-new titles in one pass is an ordinary thing to do and takes
the same unactionable 400 that B10 exists to prevent. Different axis (per-save, cross-list,
catalog-relative), so `max` does not touch it. B10's discipline is not fully satisfied until it is.

## G6 — Chunking discipline and the canonical disabled treatment (2026-08-01)

Executes group G6 of `dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md`: D2, D7, the
canonical disabled-control treatment, and the two forbidden historical-context comments.

### G6-1 — D2: `resolveIds` is chunked

`resolveIds` in `src/app/api/titles/search/route.ts` bound `...ids` directly, and
`MAX_RESOLVED_IDS` is 100 — exactly D1's hard ceiling, with zero headroom. It was the only
`.bind(...spread)` in the codebase outside `chunk` / `D1_IN_CHUNK_SIZE`. Now loops
`chunk(ids, D1_IN_CHUNK_SIZE)` accumulating into the existing `byId` map; the closing
`ids.map((id) => byId.get(id))` still re-imposes the caller's order, so chunking cannot reorder.

**The plan's two prescribed tests cannot fail before the fix.** Both are order assertions, and the
old code preserved order too; the fake D1 rejects only *above* 100, so it cannot distinguish "at
the ceiling" from "one over" — which is the plan's own stated reason the bug is invisible. Wrote
both anyway (they pin behavior) plus a third that does fail first: `src/test/statement-recorder.ts`
wraps a `D1Database` and records each bound statement's parameter count, and the test asserts the
widest is `<= D1_IN_CHUNK_SIZE`. It failed with `expected 100 to be less than or equal to 90` —
the headroom property PLAT-1 actually asks for, rather than "it happens to fit today".

Gates: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 59 files / 618 passed / 2 skipped
(615 baseline + 3), no new warnings.

### G6-2 — D7: one chunked `IN()` for the profile PUT's existence check

`PUT /api/user/profile` ran `SELECT 1 FROM titles WHERE tmdb_id = ?` once per referenced id in a
sequential loop — up to 100 D1 round-trips inside the request the ritual's "Continue →" button
blocks on. Replaced with one chunked `IN()` per `D1_IN_CHUNK_SIZE`, with `content_type = 'movie'`
as a SQL literal so a 90-item chunk keeps full headroom.

`unknownIds` is built by filtering `referenced` against the resulting `Set`, never from query
results: it and `failedIds` are order-visible to the client, and `IN()` result order is not the
caller's order.

The failing test asserts round-trips, which is the actual defect — it failed at
`expected 100 to be less than or equal to 2`. The order test passes before and after (the old loop
preserved order too) and exists to pin the property the rewrite could have broken; its fixture
interleaves known and unknown ids in non-ascending order, per testing-pitfalls §4.

Gates: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 59 files / 620 passed / 2 skipped.

### G6-3 — the canonical disabled-control treatment

Eight sites across five files carried five distinct strings: `disabled:opacity-50` (four sites),
`disabled:opacity-60` (one), and three different slate/ash spellings (`profile/page.tsx:27`,
`profile/page.tsx:264`, `refine-panel.tsx:111`, no two alike). `DESIGN.md` could not say which was
right, because it had never said anything.

The rule, now in `DESIGN.md` §Accessibility beside the 2026-07-27 slate decision and in the
Decisions Log: **a disabled control leaves the amber hierarchy.** Filled controls drop the amber
fill to slate with an ash label; outlined controls drop the ash boundary to slate with an ash
label; hover is neutralised; opacity is never used. Two new exports in `control-classes.ts`,
folded into `primaryControlClasses` and `outlinedControlClasses` so every composed control
inherits them. All eight bespoke strings deleted, plus `refine-panel.tsx`'s now-vestigial
`border border-transparent` and `profile/page.tsx`'s `PRIMARY_BUTTON` alias, which had become a
bare re-export of `primaryButtonClasses` with one use.

The `disabled:hover:*` neutralisers are not decoration: `:hover` still matches a disabled button,
and Tailwind resolves same-specificity variants by stylesheet order, not class-attribute order.

**Two things the plan predicted wrongly, both caught by running the test rather than trusting the
numbers** (the plan explicitly says reality wins):

1. The plan predicted `components/control-classes.ts: 4` in the `ALLOWED` map. First run said 5 —
   a doc comment of mine quoted a class token, and the walker's regex matches prose. Reworded the
   comment; 4 is correct once no prose names a token.
2. **The plan did not anticipate that folding the outlined treatment in breaks the existing 1.4.11
   assertions.** Five of them assert `className` does `not.toContain("border-slate")` on resting
   controls, and the sanctioned `disabled:border-slate` contains that substring. Only the
   tag-picker's Add button actually failed (chips, toggles and group rows compose from
   `outlinedBoundaryClasses`, which is untouched), but the assertion was wrong for all five.
   Narrowed to `/(^|\s)border-slate\b/` — an unprefixed utility, which is exactly what 1.4.11
   governs, since it exempts inactive components. Not a weakening: the count-based allowlist is
   still the global guard, and it is now exact about resting state.

`ALLOWED` changes: added `components/control-classes.ts: 4`; `app/profile/page.tsx` 3 → 1;
`components/refine-panel.tsx` 2 → 1; `app/groups/page.tsx` unchanged at 5 (its treatments were
opacity, not slate). Comments beside the two changed counts updated — at a count of 1 the old
"+ disabled: boundary" text would have been false.

The rendered assertion is on `RefinePanel`, a real call site, not on
`<button className={primaryButtonClasses}>` — that render would only re-state its own input, the
derived-prop-as-input anti-pattern the plan's §0.3 Round C names. `control-classes.test.ts` pins
the constants directly, and a source walk now fails if any file reintroduces `disabled:opacity-`.

**jsdom proves class strings and structure, not pixels.** No visual verification is claimed here:
jsdom has no cascade, no layout, and no painted colour.

Gates: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 59 files / 627 passed / 2 skipped.

### G6-4 — the two forbidden historical-context comments

CLAUDE.md forbids temporal and historical context in comments. `src/lib/db.ts:2` and
`vitest.config.ts:2` both opened by naming the project they were ported from, which says nothing
about what the file does. Both `ABOUTME:` lines now describe the file as it is. No behavioral
change, so no new test — the existing suite passing unchanged is the whole verification.

`migrations/0001_initial_schema.sql:1` carries a similar clause and was deliberately left alone:
it has already been applied to the remote database, and the plan scopes this task to two lines in
two files. The remaining references live in historical plan documents, where provenance is the
point.

### G6 review rounds (plan §0.3)

**Round A — correctness.** Boundaries verified line by line against plan §1.3: `groups/page.tsx`
line 288 and the `copyInvite` comment (G5's) untouched; `profile/page.tsx` lines 232-235 (G3's
deletion copy) untouched; `ritual/page.tsx` limited to line 337. `outlinedBoundaryClasses` and
`primaryFillClasses` are byte-identical — no resting or hover colour moved. No control gained a
`disabled` attribute. All eight controls that carry one now get exactly one treatment matching
their level, and none carries both.

**One out-of-region edit, surfaced rather than hidden.** Deleting the bespoke string from
`profile/page.tsx:27` left `const PRIMARY_BUTTON = primaryButtonClasses` — a bare alias with a
single use. Inlining it touched line 180, outside G6's named region. No other group owns that line
(G3 owns 232-235), so the rebase risk is nil, but the plan says to surface rather than edit across
a boundary, so it is surfaced here and in the PR.

**Round B — adversarial.** The plan asserts the disabled treatment wins over the resting fill and
over hover. Verified against the *compiled stylesheet* rather than reasoned about: in
`.next/static/chunks/*.css`, `.bg-amber` is at byte 15836, `.hover\:bg-warm-white` at 23699,
`.disabled\:bg-slate` at 24554 and `.disabled\:hover\:bg-slate` at 24894. The disabled variant is
both higher-specificity (`:disabled` adds a pseudo-class) and later in source order than hover, so
it wins twice over; the border pair has the same shape. This is the one claim jsdom could not
support, and it is now backed by the real build output.

Chunking cannot change behavior for duplicates (`parseIds` and the profile's `referenced` both
dedupe upstream) or for empty input (`chunk([])` yields no chunks and the route short-circuits at
`ids.length === 0`).

Tailwind's content scan reads markdown, so `disabled:opacity-50` and `-60` rules still appear in
the bundle — emitted from the plan and research documents in `dev/` and from the two test files
that assert the token's *absence*. ~80 bytes of dead CSS that no element references. Not worth
"fixing": the fix would be to stop writing tests that name the banned token.

**Round C — test quality.** Two findings, both fixed.

1. **Vacuous-pass risk.** `Math.max(...reads.map(...))` returns `-Infinity` over an empty array,
   which clears any ceiling, and a zero count clears any upper bound. If the SQL ever stopped
   matching the filter, both chunking tests would have passed while measuring nothing. Both now
   assert `reads.length > 0` first.
2. **The narrowed boundary assertion was broader than intended.** The first cut,
   `/(^|\s)border-slate\b/`, exempted *every* variant prefix — it would have let a real
   `hover:border-slate` on a control through, and hover is a state 1.4.11 governs. Replaced with
   `/(^|\s)(?!disabled:)\S*border-slate\b/`, which carves out only the sanctioned `disabled:`
   prefix and still catches `hover:`, `focus:` and responsive variants. Checked against ten
   hand-built class strings covering both directions before adopting it.

Also confirmed: no new test asserts a derived value passed straight back as its own input — the
rendered assertions run against `RefinePanel`, a real call site, and the class constants are
asserted as constants in `control-classes.test.ts`, not laundered through a render.

An independent reviewer ran the three rounds in parallel with the self-review. Its report reached the
coordinator rather than this session, so the rounds above are the author's own and the two findings
they produced were fixed before the PR opened; the reviewer's batch is recorded in the next section.

### G6 — second review batch

An independent reviewer confirmed the two self-caught fixes and found no remaining correctness
defect. It also re-derived the narrowed 1.4.11 guard from scratch: `disabled:hover:border-slate` is
killed by the lookahead, `md:` / `hover:` / `aria-checked:` / `focus-visible:` prefixes are all still
caught, and `\S*` cannot cross whitespace, so `"hover:border-cream disabled:border-slate"` does not
false-match. Its one false positive is the reversed `hover:disabled:border-slate`, which is
harmless. Four items were actionable.

**1. Asymmetric assertion.** `control-classes.test.ts` checked the filled string against the whole
`border-slate` token but the outlined string against `disabled:bg-slate` only — so a bare or
`hover:`-prefixed slate *fill* added to `disabledOutlinedClasses` would have passed, which is
exactly the "never a fill change on an outlined control" half of the rule. Both sides now match the
bare token.

**2. "Six treatments" was wrong, and it was headed into a permanent design doc.** There are **five
distinct strings** — `disabled:opacity-50`, `disabled:opacity-60`, and three different slate
spellings (`profile/page.tsx:27`, `profile/page.tsx:264`, `refine-panel.tsx:111`, no two alike) —
across eight sites in five files. The figure was inherited from the plan's header, which also said
"six files". Corrected in `DESIGN.md`'s Decisions Log, in the test comment, and above.

**3. `statement-recorder.ts` rests on an unstated assumption.** `Object.create(statement)` delegates
`first`/`all`/`run`/`raw` to the real object, and those read `db`, `sql` and `params` through the
prototype chain. That works only because `FakeD1PreparedStatement` uses TypeScript `private`, which
erases to ordinary properties. ECMAScript `#private` fields would break every delegated call — and
`fake-d1.ts` is PREP's file, so someone could make that change without ever opening this one. The
dependency is now stated in the doc comment, along with the related trap that a fake method
assigning to `this` would write to the wrapper rather than the real object.

**4. Two boundary crossings, disclosed rather than reframed.**

- **Rewriting the five pre-existing 1.4.11 assertions in `control-contrast.test.tsx` was an
  ownership crossing, not a plan omission.** Plan §1.3 grants G6 "the `ALLOWED` map and its
  comments" — not those assertions. The alternative the plan leaves open is to *not* fold
  `disabledOutlinedClasses` into `outlinedControlClasses`, which was never surfaced before choosing.
  The call stands: folding is plan step 2, and the assertions were imprecise about resting state
  regardless. But it was a deliberate decision, and the earlier write-up framed it as the plan
  failing to anticipate something, which understated it. For the record, only the tag-picker's Add
  button actually broke — `Chip`, `ToggleRow`, `RoughDayToggle` and the `GroupPicker` row all
  compose from the untouched `outlinedBoundaryClasses`.
- **G6-3 says "do NOT add a disabled treatment to `<Link>` elements", and step 2's mandated fold
  does exactly that.** Four anchors now carry `disabled:*` utilities:
  `results/[sessionId]/page.tsx:156` and `:384`, and `tonight/page.tsx:85` and `:91`. Inert —
  `:disabled` never matches an `<a>` — but a literal crossing of a stated boundary. (The reviewer
  also cited `page.tsx:80` and `tonight/page.tsx:102`; both are false positives. The first is a
  `<button>`, the second a text link with bespoke classes and no control string.)

### G6 — third review batch

A second independent reviewer returned approve-with-fixes. It attacked the 1.4.11 guard with 27
strings — `hover:`, `focus-visible:`, `sm:`, `md:hover:`, `dark:`, `group-hover:`, `peer-checked:`,
`aria-disabled:`, `data-[state=open]:`, `[&:hover]:`, `!border-slate`, `border-slate!`,
`border-slate/50`, newline and tab separation, and `"disabled:border-slate border-slate"` — without
defeating it, and confirmed against the generated stylesheet that every `disabled:`-initial token
compiles to a selector requiring `:disabled`, so an exempt token can only ever paint an inactive
component. It also counted all 21 allowlist entries as exact, proved both new tests fail against
`origin/dev`'s route files, exercised `chunk()` at n=0/1/89/90/91/100/180/181 with no off-by-one and
no empty chunk, and confirmed the refine-panel disabled state in a real browser: slate fill
`rgb(45,53,72)`, ash label, border-width 0, no paint movement on hover across all three control
shapes.

**One must-fix: four newly-added comments narrated history.** An ironic defect in the change whose
G6-4 task exists to delete exactly that. `control-classes.test.ts` counted what call sites used to
carry; two allowlist entries said the treatment "is central now"; the profile test described the
existence check's former shape. All four now state the present constraint and why it holds. A fifth
of my own ("as strict as a bare substring check everywhere it was ever meaningful") was caught in
the same sweep and rewritten to enumerate what the pattern still catches. The corrected count stays
in `DESIGN.md`'s Decisions Log, which is explicitly a historical record.

**Declined, with reasons.** The reviewer noted no render test exercises an actually-disabled
*outlined* control: "Start over" is never disabled, and the three that can be disabled
(`groups/page.tsx:325` and `:429`, `profile/page.tsx:264`) live inside page components that would
need auth, router and fetch mocking to render. Such a test would exercise the mock harness, not the
treatment, and a render of `<button className={secondaryButtonClasses} disabled>` would only
re-state its own input — the anti-pattern already rejected for the filled case. The composition
assertions in `control-classes.test.ts` prove every outlined variant carries the treatment, and the
browser check above covers the paint. Left uncovered deliberately rather than covered dishonestly.

## G3 — Sessions, groups, and account deletion (B5, B8, B9, B15, B14, D4)

Branch `claude/rem-g3-sessions`, rebased onto `origin/dev` after G6 landed. Six tasks, six commits
plus one review-fix commit. Suite went from 688 passed / 2 skipped (`origin/dev`) to 717 / 2 — 29
new tests, no new skips, no change to the 3 baseline `vite:dynamic-import-vars` warnings.

**B5 — the deleted user's name survived in every persisted round.** `deleteAccount` anonymized
`session_members` and deleted the `users` row but never touched `recommendations.ai_response`, which
the session GET re-serves verbatim. `scrubNameFromRounds` now runs *before* the batch — the batch
destroys both the join key the scrub needs and the row the name is read from, so the order is
load-bearing rather than stylistic, and it is also the safe failure order (a partial scrub leaves
the account undeleted and retryable). It parses each blob and mutates the object: the structured
`tasteMap.members[].name` keyed on `userId` always, and four prose fields (`conversational`,
`tasteMap.overlap.summary`, each `members[].summary`, each `recommendations[].explanation`) behind
a word-boundary literal replacement. Running the replacement over the serialized JSON would have
rewritten document *keys* for a user named "name", so the parsed-object approach is pinned by a
test. Free-text replacement is suppressed entirely when a surviving member shares the name
(case-insensitively) — a blind replacement would scrub the survivor out of their own record — and
for names under two characters. `escapeRegExp` deliberately omits `-` and `/`: escaping them is a
`SyntaxError` under the `u` flag, which would have made deletion a 500 for anyone called
"Anne-Marie".

**Accepted collateral, made visible rather than surprising:** a literal replacement cannot tell the
member "Carrie" from the film *Carrie*. A test asserts that both are replaced.

**B8 — the weighting note claimed something the engine had not done.** `computeWeightNote` cancels
the weighting when *every* member toggled, but the note asserted the picks leaned toward everyone
else. Gating it on whether weighting actually applied was rejected on privacy grounds, not
convenience: the toggler knows their own flag, so in a couple the note's presence would be a direct
readout of their partner's private flag, against DESIGN.md's Rough-Day Toggle invariant. DESIGN.md
line 124 already specifies the note should describe the user's own choice back to them, so the copy
now does that and claims no outcome. `SessionView` is untouched and the page-level derivation is
unchanged.

**B9 — `member_count` disagreed with the members the prompt sees.** The subquery counted
`session_members` raw while `getSessionMembersWithProfiles` inner-joins `users`, so after one member
of a couple deleted their account the survivor's session reported `solo: false` while exactly one
member reached the model — and the prompt asked a group of one where their tastes overlap. The
count joins `users` on the same basis. The new test asserts the two against each other; they had
complete unit tests in separate `describe` blocks against separate fixtures, which is precisely why
nobody noticed they disagreed.

**B15 — two `__solo__` groups per user.** Check-then-insert with a per-call random id *and* a
per-call random invite code: two callers past the fast-path `SELECT` both satisfied
`UNIQUE(invite_code)` and both succeeded. The identity is now derived from the user, so the second
insert has nothing to claim. The group insert / re-select / member insert are three separate
statements, **not** a batch: D1 enforces foreign keys, so batching would put the losing caller
inside a transaction that rolls back on exactly the double-tap this absorbs. The fast-path `SELECT`
stays — it keeps the steady state at one query and is what keeps random-id solo groups working.

*Surface-area note:* the solo invite code is now derivable from a user id, and user ids are
serialized to co-members via `tasteMap.members[].userId`. Three independent guards keep it unusable
— the join route's 8-char `CODE_FORMAT`, `joinGroup`'s `name != '__solo__'` predicate, and the
membership check in `createMovieSession` — and B14's `leaveGroup` guard closes the one route that
previously accepted a solo group id. A test asserts the code cannot be joined.

**B14 — the deletion copy promised something deletion does not do.** It said "This deletes your
profile, your groups and your sign-in", but `deleteAccount` never touches the `groups` table.
Cascading orphaned groups was rejected: "empty" is defined by `group_members`, but a member who left
via `leaveGroup` keeps their `session_members` rows and a legitimate read of that history, so
"A leaves, then B deletes" would destroy every session A can still read. The copy was what was
wrong. `account.test.ts` now asserts the non-deletion explicitly so a later agent cannot
"helpfully" add the cascade. `leaveGroup` also rejects `__solo__` ids — unreachable through the UI,
which never lists solo groups, but the API accepts any id.

**D4 — `rate_limit_log` grew without bound.** The prune is a separate statement with its own
`try/catch`, never batched with the INSERT: `batch()` is a transaction, so a failed prune would roll
back the rate-limit record while the caller went on to join. Scoped to `(scope, key)` so it uses
`idx_rate_limit_scope_key` and cannot reach a future `'match'` scope with a different window.
Rate-limit correctness is unaffected — the rows removed are already outside the counted window.

### Gotchas found

- **PREP has not landed on `dev`.** `withFailingStatement` does not exist, so D4's failing-prune
  test uses a local statement-failure double in `groups.test.ts`. It should be replaced with the
  shared helper when PREP-1 lands. Same dependency affects G1/G2/G4.
- **The fake D1 cannot race.** B15's tests prove repeated-call idempotency and the losing racer's
  *position* (a group row present with no membership row), never simultaneity. Named and commented
  as such, per testing-pitfalls §5.
- **`src/app/results/[sessionId]/page.test.tsx` is timing-fragile under load.** Its "never sends
  more removed ids" case has a 20s timeout and swung between 11.9s and 23.6s on this machine while
  other agents were running suites; it timed out once and passed on every re-run. Not touched — it
  is not in G3's region — but it will flake in CI under contention.

## PREP — test harness + migration plumbing

**Built:** `withFailingStatement()` / `injectedFailureCount()` in `src/test/fake-d1.ts`, a
`loadMigration()` that concatenates every `migrations/*.sql` in filename order, a `migrate:local`
that iterates the same sorted glob, and 23 tests in `src/test/fake-d1.test.ts`. Unblocks G1's B4,
G2's B12 and G3-6, whose interrupted-success paths had no way to fail a single D1 statement, and
makes any migration past `0001` visible to the test suite.

**Public API — what G1–G4 consume:**

```ts
withFailingStatement(db: D1Database, injection: FailureInjection): D1Database
interface FailureInjection { match: string | RegExp; onCall?: number; error?: Error }
injectedFailureCount(db: D1Database): number
```

The wrapper fails the matching statement at execution (`run`/`first`/`all`/`raw`/`exec`), never at
`prepare()`. `bind()` rewraps, so `prepare().bind().run()` — the shape of every statement in this
codebase — stays gated and shares one `onCall` counter.

**Decisions:**
- **`bind()` had to rewrap, and that is the whole ballgame.** `FakeD1PreparedStatement.bind()`
  returns a new instance rather than `this`. Wrapping only what `prepare()` returns would have left
  every failure-injection test in G1–G4 passing against unfixed code. Proven by mutation: dropping
  the rewrap fails four tests.
- **`injectedFailureCount` was added beyond the plan's pinned shape.** Adversarial review found that
  every way the helper can fail to fire is silent, and the assertions G1–G4 will write are true on
  the happy path too — a one-character typo in `match`, an `onCall` past the number of matching
  executions, or a wrapper built after a route's db mock was set all yield a test that passes
  against the bug it was written to catch. The counter is additive and leaves the pinned signature
  untouched. **Assert it in any interrupted-success test.**
- **`batch()` refuses statements not prepared from the same handle**, comparing gate identity rather
  than class so a second wrapper over the same db is also refused. It would otherwise run them
  ungated and go green. This is stricter than "passes everything else through unchanged".
- **`exec()` is gated too**, and it advances the shared `onCall` counter. Fixture setup run through
  the wrapper therefore consumes matches — relevant because eight test files seed via `db.exec()`.
- **`migrate:local` stays strict.** A failing file fails the script; the reset step lives in
  `docs/deploy.md` §2. A loop tolerating "already exists" per file is how a malformed migration goes
  unnoticed locally.

**Gotchas:**
- **`src/test/fake-d1.test.ts` already existed** (the plan calls it new). Appended rather than
  restructured.
- **The plan's 13-table test cannot distinguish the old `loadMigration` from the new one** while
  `migrations/` holds one file — it passes against both. The multi-file behavior is covered instead
  by a temporary-cwd test over a fixture directory, `loadMigration` resolving its directory from
  `process.cwd()`. The cwd is borrowed for one synchronous call and restored in a `finally` before
  any assertion runs. Requires vitest's `forks` pool; under `threads`, `process.chdir` is undefined.
- **The `.sort()` in `loadMigration` is unprovable on macOS.** APFS returns `readdir` results
  already in byte order, so removing the sort changes nothing locally; ext4 on CI is hash-ordered
  and would catch it. The test asserts the ordering property either way and says so rather than
  implying coverage.
- **Table names cannot start with a digit** — the migration fixture's tables are `t1`..`t4`, not
  `0001_first`.
- After rebasing onto `dev`, `loadMigration()` applies `0001` and G7's `0004` for real: `0004`'s
  `idx_recommendations_created_at` is present and the `idx_recommendations_session` it drops is
  gone, so ordering holds on actual migrations, not just the fixture.

**Reported, not fixed (outside PREP's ownership):**
- `createFakeD1().batch()` still accepts statements prepared from a *different* fake and silently
  runs them against the wrong database. The plan forbids changing `createFakeD1`'s default
  behavior, so only the wrapper guards this — the same mistake is loud through one handle and silent
  through the other, in files that will hold both.
- `npm test -- <file>` runs the whole suite: `--pass-with-no-tests` swallows the following
  positional, so the filter is ignored. Left alone because sibling groups depend on that script.
- `src/app/results/[sessionId]/page.test.tsx`'s "never sends more removed ids than the route will
  accept" times out under load (20 s budget); clean when run unloaded.

**Quality checks:** `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 60 files /
711 passed / 2 skipped, only the 3 pre-existing `vite:dynamic-import-vars` warnings. A 22-mutant
study over `fake-d1.ts` kills 20; the survivors are the APFS-unkillable `.sort()` and one malformed
no-op mutant.
---

## G4 — cron and worker (2026-08-01)

Group G4 of the Phase 1 bug-hunt remediation plan
(`dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md` §4): B6 (weekly-refresh starvation),
D6 (cron error attribution), and the `STALE_TITLES_LIMIT` comment correction.

### G4-3 — `STALE_TITLES_LIMIT` comment and the plan-tier documentation

No behavioral change, so no new test — the constant stays at 200 and the query around it is
untouched. The old comment asserted a 1,000-subrequest Paid ceiling and told a deployer on the
Free plan to lower the constant to ~40. Both halves were wrong, and I re-verified the replacement
against the Cloudflare docs rather than the plan's summary of them:

- The 1,000-subrequest limit was removed 2026-02-11; Workers Paid now defaults to 10,000 per
  invocation (configurable to 10M via `limits.subrequests`).
- Workers Free is 50 *external* subrequests plus a separate 1,000-call budget for Cloudflare
  services. D1 calls draw on the internal budget, so the 9 D1 calls a run makes never compete with
  its 200 TMDB fetches.
- CPU is the real Free-plan blocker: 10 ms per cron invocation on Free against 15 min on Paid at a
  weekly (≥ 1 hour) interval. 200 TMDB detail parses do not fit in 10 ms and neither does an
  OpenNext SSR render, so lowering the constant buys nothing and costs the catalog-freshness goal
  B6 exists to protect (40/week over ~1,000 titles is a 25-week sweep).

`docs/deploy.md` §Plan-tier check now states Workers Paid as a prerequisite with the numbers in a
table, and no longer carries the "drop it to ~40" advice.

Gates: `npx tsc --noEmit`, `npm run lint`, `npm test` all pristine — 59 files / 627 passed /
2 skipped, unchanged from this branch's base as expected for a comment-and-docs change. (627, not
the plan's 615: G4 is stacked on PREP, whose `fake-d1.test.ts` adds 12 cases.)

### G4-2 — D6: rows not statements, split counters, and a named cron crash line

Three changes to the cron's observability, all in `src/lib/cron-handler.ts` and `worker.ts`:

- `flush()` now sums `meta.changes` across the `db.batch` results instead of adding
  `batch.length`. The old count was statements *queued*; an `UPDATE ... WHERE tmdb_id = ? AND
  content_type = ?` that matches zero rows counted as a refresh.
- The single `errors` counter split into `fetch_errors` (per-title TMDB failures) and
  `write_errors` (a failed batch). One number could not distinguish a TMDB outage from a D1 write
  failure, which is the first thing you need to know from the summary line.
- `worker.ts` awaits `runWeeklyRefresh` inside `try/catch`, logs a `cron_failed` line, and
  rethrows. A rejection handed to `ctx.waitUntil` still reports the invocation as *successful* to
  Cloudflare's cron metrics; awaiting and rethrowing marks it failed. `ctx` is now unused and was
  dropped from the signature rather than suppressed.

**The row-vs-statement test needed care.** The obvious fixture — bind a mismatched `content_type`
— cannot be built honestly: the `UPDATE` binds `row.content_type` straight from the `SELECT` that
produced the row, so the bound value can never disagree with the stored one. The test instead
deletes the first title's row from inside the injected `fetchImpl` while it handles the second id,
which is the only way production code can emit a statement matching zero rows. Writing a statement
the production code never emits would have been testing the test.

`worker.ts` has no test file (it is excluded from `tsconfig.json` because it imports build-time
OpenNext artifacts); the change was verified by reading and by `npx @opennextjs/cloudflare build`,
which completed clean.

Gates: `npx tsc --noEmit`, `npm run lint`, `npm test` (59 files / 628 passed / 2 skipped — the
PREP-stacked base of 627 plus the one new row-counting test), and the OpenNext build.

### G4-1 — B6: the weekly refresh sweeps the whole catalog and never fakes freshness

`migrations/0003_title_refresh_attempt.sql` adds `titles.last_refresh_attempt_at` and backfills it
from `last_refreshed_at`. The cron now predicates on the attempt column and orders on the success
column:

```sql
WHERE last_refresh_attempt_at IS NULL OR last_refresh_attempt_at < <now -7 days>
ORDER BY last_refreshed_at ASC, popularity DESC
```

SQLite sorts NULLs first on `ASC`, so never-successfully-refreshed rows lead and popularity is the
within-run tiebreaker. The success `UPDATE` stamps both columns; the per-title failure path queues
an attempt-only `UPDATE` on a **separate** array with its own flush, so its changed rows can never
reach `refreshed` — a run where all 200 fetches fail must report `refreshed: 0`, not 200.

`last_refreshed_at` is never written on a failure. `asOfNote()` renders it on every pick's
streaming line, so stamping it on a failed fetch would make the UI assert a freshness that never
happened.

**What each new test actually discriminates.** Reverting only the query (predicate and ORDER BY)
fails four of them: the predicate test, the week-elapsed sweep, the permanently-failing-title test,
and the composite-ordering test. Two are guards that pass either way and are named to claim nothing
more — the no-time-elapsed forward-progress test (with every fetch succeeding, a predicate on
`last_refreshed_at` advances too) and the attempt-stamps-never-inflate-`refreshed` test (the
unfixed code wrote no attempt stamps at all, so its counters happen to agree).

Mechanism B — a week's jitter re-qualifying the whole popularity head — *is* provable here, and the
first version of this work wrongly recorded that it was not. The fake D1's clock is SQLite's own
`now` and cannot be moved, but rewinding the stored timestamps by 8 days is equivalent for a
predicate and an ORDER BY that only ever compare stored values against `now`. `rewindOneWeek()` does
that, and against the unfixed query the two runs come back identical instead of disjoint.

Fixtures were rewritten to states production can actually reach: every writer of a `titles` row
(`scripts/seed-lib.ts`, the profile-save enrichment insert, the cron's own success `UPDATE`) sets
`last_refreshed_at`, so a NULL there is not a producible state and no fixture uses one any more
(testing-pitfalls §7). A NULL `last_refresh_attempt_at` *is* producible — those two inserts do not
set it — and is kept where it is the point of the test.

Two write-error branches are now covered with PREP-1's `withFailingStatement`: a failed refresh
write (`UPDATE titles SET streaming …`) and a failed attempt stamp. The second counts the title in
both `fetch_errors` and `write_errors` — they describe different failures of the same title, and
swallowing the write failure would hide a D1 outage on the failure path entirely. I mutation-checked
that branch (removing the counter increment fails the test) because the test was written after the
code it covers.

`docs/deploy.md` §2 gains the `### Pending migrations — not yet applied to the remote database`
subsection with `0003` in it. The plan assigns creation of that subsection to G1 (which lands
`0002` and merges first); G1 was not present in the tree when this landed, so G4 created it rather
than append a migration line under a heading marked ✅ DONE where a deployer would skip it.

Gates: `npx tsc --noEmit`, `npm run lint`, `npm test` — 59 files / 637 passed / 2 skipped, still
exactly 2 skips, no new warnings.

### G4 — query-plan note for whoever next touches `titles` indexing

The candidate query's plan changed. Before, `ORDER BY popularity DESC LIMIT 200` walked
`idx_titles_popularity` and stopped early (`dev/reports/2026-08-01-performance-audit.md:456`).
The composite `ORDER BY last_refreshed_at ASC, popularity DESC` cannot use that index, so
`EXPLAIN QUERY PLAN` is now:

```
SCAN titles
USE TEMP B-TREE FOR ORDER BY
```

Over a ~1,000-title catalog, once a week, that is negligible — it is not worth a covering index
today, and the plan explicitly allocates only one migration to this group. Recorded here so a
future catalog an order of magnitude larger has the starting point rather than a surprise.

### G4 — findings from the independent review round, and what changed

An adversarial review by a fresh agent with no session context found one blocker and three
substantive issues. All are fixed above; recorded here because the blocker is the interesting one.

**Blocker — the flagship forward-progress test proved nothing.** Seeding 400 titles, running twice
with no time elapsed, and asserting disjoint windows passes against the *unfixed* query: with every
fetch succeeding, a predicate on `last_refreshed_at` advances exactly as well as one on the attempt
column. Its comment also claimed to model cron jitter, which a non-advancing clock does not do. The
test is now split: one case models a real week passing (`rewindOneWeek()`) and fails against the
unfixed query, and one keeps the immediate-rerun guard under a name that claims only that.

**Two evidence lines were copied from the plan rather than observed.** The gate results recorded for
G4-3 and G4-2 said 615 and 616 — the plan's `origin/dev` baseline. This branch is stacked on PREP,
whose `fake-d1.test.ts` adds 12 cases, so the observed numbers were 627 and 628. Corrected. Writing
down a number you expect rather than the one that printed defeats the point of the gate.

**Fixture realism.** See the note above about NULL `last_refreshed_at`.

**Two accuracy corrections to comments.** The subrequest comment said D1 calls "never compete" with
TMDB fetches; that holds on Free, which has a separate 1,000-call internal budget, but on Paid
internal and external subrequests share the single 10,000 limit. And `worker.ts`'s comment described
`waitUntil`, which the file no longer contains — it now reads as a prohibition against reaching for
it, which is the durable form of that warning.

**Surfaced, not fixed:** neither `scripts/seed-lib.ts` nor the profile-save enrichment insert in
`src/app/api/user/profile/route.ts` writes `last_refresh_attempt_at`, so a title they insert looks
due for a refresh the moment it lands. The seeder is the one that matters: it is an
`INSERT OR REPLACE` over the whole catalog, so a re-seed resets every attempt stamp the cron has
written. The profile route only enriches ids its own existence check found missing, so it never
replaces a live row. Both files belong to other groups' scope; filed as follow-up.

### G4 — second review round

A second independent review checked the first round's fixes and swept for what it missed. It
confirmed `rewindOneWeek()` is sound (a uniform shift of both stored columns is order- and
difference-preserving for a predicate and an ORDER BY that only compare stored values against
`now`), reproduced the four-test kill on a reverted query, and re-ran each recorded gate number
from its own commit. Three things came out of it:

**The 7-day window was not tested.** Every fixture was either 2020 or an hour ago, so
`sqliteIsoNow("-7 days")` could be changed to `-1 days` or `-30 days` with all tests still green —
a wrong window would ship either 7× the TMDB spend or a catalog that never sweeps. There is now a
boundary case with rows at 6 and 8 days; it fails under both of those mutations.

**A false claim in this log, corrected above.** The profile route's `INSERT OR REPLACE` cannot
overwrite a live `titles` row, because the ids it enriches are exactly the ones its own existence
check did not find. The seeder is the writer that genuinely resets attempt stamps on every re-seed.

**Residual edge, in spec but worth naming.** A permanently-failing title's attempt stamp ages out on
the same 7-day cadence as everyone else's, so 200 or more permanently-failing titles would starve
the sweep again — the same failure class as B6 at a higher threshold. The plan's contract ("a
permanently-failing title consumes at most one slot per 7 days") is met; a catalog that ever
approaches that threshold needs a different mechanism, such as backing off per consecutive failure.

### G4 — final gate numbers

The per-task numbers above were observed at the commits that produced them, on the PREP commit this
branch first forked from. PREP moved on, so the branch was rebased onto its tip and everything
re-run there:

```
npx tsc --noEmit   clean
npm run lint       clean
npm test           59 files / 645 passed / 2 skipped
npx @opennextjs/cloudflare build   clean
```

645 = the PREP tip's 634 plus G4's 11 new cron cases (8 → 19 in `cron-handler.test.ts`). Still
exactly 2 skips, still only the three baseline `vite:dynamic-import-vars` warnings.

---

## 2026-08-01 - G2: matching engine + match route (10 tasks)

Branch `claude/rem-g2-matching`, stacked on `claude/rem-prep` (G2-6's failure-injection test needs
PREP-1). Nine commits, one per task. Gates green before each: `npx tsc --noEmit`, `npm run lint`,
`npm test`, plus `npx @opennextjs/cloudflare build` (exit 0) because `src/app/` changed.
**59 files / 699 passed / 2 skipped**, up from the 634 this branch inherited from PREP. Still
exactly the two `RUN_LIVE_EVALS`-gated skips, and only the three known
`vite:dynamic-import-vars` baseline warnings.

**What changed.** `removedTmdbIds`/`keptTmdbIds` are intersected against `getRecommendedTmdbIds` --
the ids this session actually recommended -- before they reach anything, because the next task
turns them into a pool primitive. `selectCandidates` takes a required `removedIds` set and filters
the whole pool before the referenced/fill split, so a rejected film cannot walk back in as a
member's own watchlist entry; no floor, an over-constrained brief fails honestly as
`thin_results`. The exclusion list is now built newest-first (`ORDER BY round_number DESC` plus a
flipped union order) and capped at 100 entries of its own rather than sharing the 50-entry title
cap. `POST .../match` gates on live `group_members`; the GET stays `session_members`-based on
purpose. `MONTHLY_MATCH_LIMIT=0` arms the kill switch. A 401/403 from Anthropic becomes
`MatchingError("provider_auth")` -> 503 with a `provider_auth_failed` log line. A titles-hydration
failure degrades to `{}` instead of throwing away a billed round. One `isMatchingResponse`
predicate guards both the write and the read path. The Anthropic client carries a 45 s request
timeout. Every user-derived string entering the prompt goes through one sanitizer, the two
free-text fields lost their surrounding quotes, and the guardrail now covers the system prompt --
where `steeringNote` and `refinementNote` actually live.

**Decisions taken.**

- *Exclusion cap 100.* ~10 tokens per `Title (tmdbId 12345)` entry against a 7-9K-token CANDIDATES
  block, so ~1,000 tokens, ~11-14% of it. The reachable legitimate ceiling is 10 rounds x 7 picks
  = 70, so every honest list fits under the cap with headroom.
- *Timeout 45 s.* Three times the top of the design doc's 5-15 s budget. The SDK retries timeouts,
  so worst case is 90 s per attempt; `runMatching` retries only on `malformed`, which is a fast
  failure, so the pathological ceiling is 180 s -- down from a ~20-minute tail.
- *`provider_auth` is a new kind, not a reused one.* `MATCHING_ERROR_HTTP` is a
  `Record<MatchingErrorKind, ...>` so `tsc` forces the entry; `ERROR_FRAMING` is a `Map` with a
  fallback that already carries non-`MatchingErrorKind` keys, so the UI absorbs an addition. No
  existing kind is honest for a revoked credential -- `overloaded` and `timeout` both promise a
  retry that can never work.

**Gotchas found.**

- Writing `sanitizePromptText`'s control-character class with explicit `\u` escapes matters, and
  the plan says so for a reason: the first attempt landed *literal* control characters in the
  source, which are invisible in review.
- Two route-test fixtures removed a tmdb id the session had never recommended -- a state the real
  client cannot produce once provenance is enforced. Updated rather than worked around
  (testing-pitfalls section 7).
- Filtering the pool exposed a third fixture whose stubbed model response named a removed title;
  that one is the fix working, and the fixture now names only surviving candidates.
- `src/app/results/[sessionId]/page.test.tsx`'s 60-item removed-id test times out under parallel
  load. It fails on the untouched baseline too -- environmental, not this branch.

**Plan defect.** G2-9's prescribed assertion for the quoted free-text fields -- "the total count of
double-quote characters is exactly one more than for a benign value" -- passes against the
*unfixed* code: two wrapping quotes plus one injected is also "benign plus one". Both tests were
strengthened to assert the new unquoted labelled line, and to pin the benign quote count at zero.

**Cross-group note.** G2-4's membership gate makes G3-5's `__solo__` guard in `leaveGroup` load
bearing: `leaveGroup` currently accepts any group id, so leaving your own `__solo__` group would
now revoke matching on your own solo sessions. G3-5 is marked droppable in the plan; it should not
be dropped while this gate is in place.

---

## Repo hygiene — log merge strategy and a contended-timeout fix (2026-08-01)

Two recurring costs from running eight remediation groups in parallel, fixed at the root.

**`dev/implementation-log.md` now merges with `union`.** Every group appends a section at the end,
so every rebase conflicted on the same file even though no two entries overlapped semantically.
Five such conflicts were resolved by hand during the remediation campaign, and one of those
resolutions briefly emptied the file (a `sed` built from a zsh array read `${M[0]}`, which is unset
in zsh's 1-indexed arrays, so the command degenerated to a bare `d` that deleted every line — the
file was restored with `git checkout --merge`). Union resolution keeps both sides instead. Ordering
within the file carries no meaning, so a merged result is always correct; the only failure mode is
a duplicated line when two branches edit the same one, which is visible and harmless.

**`results/[sessionId]/page.test.tsx`'s 60-click case: 20s budget -> 60s.** Four separate agents hit
it, and it timed out once against unmodified `dev`, so it was never that branch's regression. It ran
between 12s and 24s on a machine hosting several concurrent suites. The assertion is deterministic;
the budget is now set clear of the contended upper end rather than the quiet-machine time, per the
project's standing rule to give heavy jsdom tests real headroom rather than trimming the assertion.
## G1 — Auth: the rotation race and the interrupted rotation (B1, B4)

**Branch:** `claude/rem-g1-auth`. **Merge classification:** `Review — auth code`. Depends on PREP.

One change to `src/lib/auth.ts`, plus `migrations/0002_session_rotated_at.sql` and the pending-
migrations list in `docs/deploy.md`. **Zero route files touched** — all 13 `authenticateRequest`
call sites are byte-identical, and `user: null` still means exactly "unauthenticated".

**What rotation did:** `DELETE FROM sessions WHERE token_hash = ? RETURNING …`, then a
`SELECT email FROM users`, then an `INSERT` of the replacement. B1 was the loser of a concurrent
claim getting `{user: null}` → 401 → landing-page redirect, deterministic for any client-side
navigation into `/ritual` (three simultaneous authenticated fetches) past the 15-minute session-
cookie window. B4 was a throw anywhere in that window destroying a 90-day session with no
compensation, outside every route's `try`, wedging the user at 401 permanently.

**What it does now:** read the row and the email in one `JOIN` before any write; claim with one
`db.batch` of `INSERT … SELECT` + `UPDATE … SET rotated_at`, identical predicates, the INSERT's
`meta.changes` as arbiter; the loser re-reads and, inside 30 s, authenticates with **no Set-Cookie**;
the winner prunes its own user's out-of-grace spent rows outside the batch.

**Decisions:**
- **The loser never mints a token.** It cannot be handed the replacement — the plaintext exists only
  in the winner's `Set-Cookie` — so retry is structurally impossible, not slow. Minting it a second
  token would leave a `/ritual` fan-out holding three unreferenced 90-day refresh tokens.
- **The grace window is decided from a re-read, never from the pre-claim read.** In the real race
  the loser reads *before* the winner's `UPDATE`, so its `rotated_at` is `NULL`. Proven by mutation:
  substituting the pre-claim value fails exactly one test, the seam test below, and nothing else.
- **Both claim statements carry `expires_at`.** Dropping it from the mark reintroduces the wedge —
  proven by mutation: the arbiter's consistency check throws.
- **The prune is scoped to `user_id`** (rides `idx_sessions_user`, covers every row this request
  could have made) and sits outside the batch in its own `try/catch`.
- **The escaping exception is accepted, not fixed.** The batch removes the *state* loss, so a blip
  is transient and a retry works; it still surfaces as a raw 500 because `authenticateRequest` runs
  before each route's `try`. Catching it to clear cookies would sign users out on a blip.

**Gotchas:**
- **The plan's prescribed sequential loser test cannot distinguish the correct fix from the
  `rotated_at`-reuse bug the plan itself boxes as "the highest-risk line in the task."** Called
  twice in a row, the second call's own pre-claim read already sees `rotated_at` set. A test-local
  `withWriteAfter` helper runs a competing rotation at one named seam — immediately after the code's
  pre-mutation read — which is the only construction that separates them. It asserts `firedCount()`
  for the same reason `injectedFailureCount` exists.
- **`withWriteAfter` is a deterministic interleaving, not concurrency.** The fake D1 is synchronous
  (testing-pitfalls §5). Nothing here proves two requests can reach the claim together; that stays a
  review check.
- **The prescribed grace-expiry test could not fail pre-fix** — the pre-fix code returned null for
  every already-claimed token. It would also have passed with the spent row gone entirely, in which
  case the window is never evaluated. It now asserts the spent row is present and marked first.
- **Two existing rotation tests asserted `oldSession` is null.** The spent row deliberately survives
  now; updated, not deleted. One of them used `expect(…).not.toBeNull()`, which a deleted row
  satisfies as `undefined` — replaced with a `typeof` check.
- **Rotation accumulates rows where it used to stay level.** The prune bounds it; both the prune and
  the requirement that a failed prune not roll back the rotation are covered.
- **`docs/deploy.md`'s `### Pending migrations` subsection already existed** — an earlier group
  created it, though the plan assigns that to G1, so the "highest-consequence documentation edit in
  the campaign" reduced to one bullet plus one command under a heading that was already right.
- **The migration list needed reordering on rebase.** G4's `0003` landed mid-flight, and a plain
  rebase left `0002` sitting below it. The list is explicitly numeric-order; fixed while resolving.
- **No fallback on `meta.changes`.** `?? 0` reads an absent count as a loss — but the batch has
  already committed by then, so the winner would skip `setAuthCookies` and the replacement's
  plaintext, the only copy, would never reach the client, signing them out 30 s later. `D1Meta.changes`
  is a required `number`; the type is the contract.

**Boundary extension — logout, fixed on coordinator decision.** `src/app/api/auth/logout/route.ts`
sits outside G1's declared file list (§1.1). It was reported rather than edited, and the coordinator
ruled: fix it in this PR, because it is a regression this change introduces rather than pre-existing
residue. Before G1 the `DELETE … RETURNING` removed the predecessor row the instant it was spent, so
logout had nothing to miss; the grace window deliberately keeps that row alive, which means a
logged-out user's *previous* refresh token stayed valid for up to 30 s after they clicked the button.
Two independent readers found it, which is a signal about how obvious it looks later. Every other
group has merged and nothing else is in flight, so there is no conflict risk.

The fix deletes that user's spent rows alongside the presented one, in one batch. **The predicate is
`user_id = ? AND rotated_at IS NOT NULL`, not all-rows-for-this-user**: spent rows are unusable
outside their grace window, so removing them cannot disturb a session another device is actively
holding, which a blanket delete would. Batched with the existing delete so a partial failure cannot
report a clean logout while leaving a graced token behind. **Accepted edge, recorded at the call
site:** another device inside its own grace window gets a 401 and re-authenticates — an explicit
logout should invalidate aggressively.

`src/app/api/auth/logout/route.test.ts` is new (the route had no tests). Four of its six cases fail
against the branch as it stood before the fix. Three mutants, all killed by exactly one test each:
un-batching the pair fails the atomicity case, dropping the `user_id` scope fails the other-user
case, dropping `rotated_at IS NOT NULL` fails the other-device case.

**Reported, not fixed (going to Sam as-is):**
- **`MAX_SESSIONS = 10`** (`src/app/api/auth/google/callback/route.ts:15`) counts spent rows toward
  the cap. Eviction is `ORDER BY created_at ASC`, so spent rows go first, and the prune is
  user-scoped — any rotation on any device clears that user's out-of-grace rows. Bounded, no change.
- **A one-millisecond boundary.** The read treats `expires_at === now` as unexpired while the claim
  predicate `expires_at > ?` does not match it, so that exact millisecond yields a 401 with cookies
  intact instead of a clean sign-out. Self-healing on the next request. `>` is what the plan pins.

**Review rounds.** Three self-review rounds (correctness against the spec, adversarial/security,
test quality by mutation) plus one independent fresh-agent round. The independent round found the
`?? 0` fallback above, the logout residue below, the unasserted expiry bound inside the grace check
(now covered and mutation-killed), two temporal comments, and that `withWriteAfter` implemented only
`prepare`/`batch` so an unseamed `exec` would have failed as "not a function". It independently
reproduced both mutation results and confirmed zero route diffs, no fake concurrency, no secret in
any log or error, and no account-existence oracle.

**Quality checks:** `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 61 files /
832 passed / 2 skipped (baseline on `origin/dev`: 816), only the 3 pre-existing
`vite:dynamic-import-vars` warnings, `npx @opennextjs/cloudflare build` clean. **12 of the file's 36
tests fail when `src/lib/auth.ts` alone is reverted to `origin/dev`** — measured by running the
suite that way, not reasoned about. A 5-mutant study over the fix kills all 5: the pre-claim
`rotated_at`, the mark's dropped `expires_at`, the grace check's expiry bound, the prune's
`try/catch`, and the prune itself.

---

## Session handoff — autonomous remediation session (2026-08-01)

`dev/handoff-2026-08-01.md` supersedes the 2026-07-28 handoff for current state. Records the final
gate run on `dev` @ 80acad9 (tsc clean, eslint clean, 832 passed / 2 skipped across 61 files,
OpenNext build clean), the sixteen PRs this session merged, the outstanding queue, and the
guardrails added along the way.

The load-bearing lesson, recorded there in full: a class of plan defect survives adversarial plan
review and surfaces only when an implementer runs the prescribed test or a reviewer checks a
justification against reality. Every one of the eight remediation groups found at least one. In each
case the code was correct and the *justification* was wrong — the failure mode that ossifies in a
comment and outlives anyone who could question it.

---

## Plan tier confirmed — Workers Paid (2026-08-01)

Sam confirmed the Cloudflare account is on Workers Paid, which closes the last standing question from
the 2026-07-28 handoff. `docs/deploy.md`'s plan-tier section changes from a pre-deploy checklist item
into a recorded ✅, and the handoff's Tier-3 entry says the same. `STALE_TITLES_LIMIT` stays at 200.

The reasoning is kept rather than deleted, because it is not dead weight: it documents why the
constant is not a tuning knob, and it still applies to a second environment or a change of account.
Added alongside it the one figure that must not be trusted from memory — Paid was capped at 1,000
subrequests per invocation until 2026-02-11, and two independent reviews of this code reasoned from
that stale number and reached opposite conclusions about this very constant.

---

## Removed-ids cap test: structural cost, not a timeout (2026-08-01)

`"never sends more removed ids than the route will accept"` in
`src/app/results/[sessionId]/page.test.tsx` was the heaviest test in the suite. Its 60-item fixture
was correct; the loop over it was not. Each of the 60 remove-clicks re-ran
`screen.getByRole("button", { name })` over the whole document, and an accessibility-tree scan is
the most expensive operation available in jsdom — so the click loop cost grew with the square of
the fixture. Querying the remove controls once, scoped to the picks tabpanel, and clicking from
that array took the isolated test from 2671ms to ~950ms and the file from 5.49s to ~2.8s. The
explicit budget came down from 60000ms to 10000ms.

Measured, not assumed: shrinking the fixture from 60 to 56 saved ~20ms once the queries were fixed,
so the fixture stays ten clear of the 50-id ceiling. A fixture that only grazes the cap proves
less. The 60 React re-renders that remain are inherent to clicking 60 controls and are what the
10000ms budget (>10x the measured time) covers on a contended CI runner.

The assertion was strengthened rather than trimmed: it now pins both ends of the surviving window
(`[0] === 1010`, `[49] === 1059`). Verified by mutation — deleting the cap fails on the length
assertion, and flipping `slice(-50)` to `slice(0, 50)` fails on `expected 1000 to be 1010`. No
sibling test in the file has the same re-scan-per-interaction shape; the only other loops advance
fake timers or walk three views over a two-item fixture.
## Follow-up: title writers stamp `last_refresh_attempt_at` (2026-08-01)

Branch `claude/seed-refresh-stamps`, off `dev` @ 0c61f84. Filed by the G4 cron agent as outside its
ownership: migration `0003` added `titles.last_refresh_attempt_at` and the weekly cron selects
candidates on it (`WHERE last_refresh_attempt_at IS NULL OR ... < now-7d`), but the two writers that
build a whole `titles` row omitted the column, so every row they wrote came back NULL — instantly
due for refresh despite having been fetched from TMDB seconds earlier.

**Both writers changed.** `scripts/seed-lib.ts` (`TITLES_COLUMNS` + `titleToInsertStatement`) and the
enrichment insert in `src/app/api/user/profile/route.ts`. Both now write `now` into
`last_refresh_attempt_at`, the same value they already write into `last_refreshed_at`.

**Why `now`, and why the same value as `last_refreshed_at`.** The column means "when did we last try
TMDB for this row", and both writers only reach the insert *after* a successful `fetchMovieDetail`.
The attempt and the success are the same event, so any value other than `now` would be a claim about
history that did not happen. Migration 0003's backfill (`SET last_refresh_attempt_at =
last_refreshed_at`) says the same thing for pre-existing rows; these writers were simply not updated
to hold the invariant it established. Copying `last_refreshed_at` and writing `now` are the same
thing here precisely *because* both writers set `last_refreshed_at = now` — that equivalence is a
property of these two call sites, not a general rule. The cron is the counter-example that proves
it: on its failure path it advances the attempt stamp and deliberately leaves `last_refreshed_at`
alone, because `asOfNote()` renders the latter to users.

**The `INSERT OR REPLACE`-over-an-existing-row case, considered separately.** The worry is a row
whose attempt stamp is *newer* than its refresh stamp — a title the cron has been failing on for
weeks. Overwriting that with `now` discards the failure history. It is still right: the seed just
succeeded where the cron kept failing, so the history is not lost, it is obsolete. Nothing keys off
the gap between the two stamps except the staleness predicate, and re-arming that predicate for a
row we just refreshed would be the bug, not the fix. Preserving the older stamp via
`COALESCE`/upsert would also be strictly worse than the pre-0003 behaviour, where a re-seed left the
catalog not-due for a week. Rejected as unnecessary complexity for a strictly worse outcome.

**Nothing was left unchanged for symmetry's sake.** The profile-route writer has a far smaller blast
radius (one row per hand-added title, and its `OR REPLACE` clause is effectively unreachable — the
insert only runs for ids a `SELECT` just proved absent), but it is the same defect and the same
one-token fix, and the invariant "every writer of a `titles` row sets both stamps" is worth more
intact than the change costs. `src/lib/cron-handler.test.ts` already documents the sibling invariant
for `last_refreshed_at` in a fixture comment.

**Not touched:** no new migration (0003's backfill already covers rows written before this change,
and rows written after it are correct at insert time), and no change to the cron's predicate or
ordering.

**TDD.** Three new assertions written first and watched fail: the seed round-trip returned `null`
for `last_refresh_attempt_at`; the re-seed-over-a-stamped-row case returned `null`, proving the
`INSERT OR REPLACE` clears it rather than leaving it; and the end-to-end check — seed a title, run
`runWeeklyRefresh` — failed with the cron fetching the freshly-seeded title
(`expected "vi.fn()" to not be called at all, but actually been called 1 times`). That third test
uses the real cron query rather than restating the predicate, so it cannot drift from it. The
profile-route assertion (`expect(row?.last_refresh_attempt_at).toBe(row?.last_refreshed_at)`) failed
`expected null to be '2026-...'`. Two pre-existing exact-SQL assertions in `scripts/seed-lib.test.ts`
also needed the new column in their expected string.

**Quality checks:** `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 61 files / 835 passed
/ 2 skipped (baseline 832 — the 3 new tests), only the 3 pre-existing `vite:dynamic-import-vars`
warnings, `npx @opennextjs/cloudflare build` clean.
