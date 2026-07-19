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

**Commit:** pending — `test: add in-memory D1 fake backed by node:sqlite`
