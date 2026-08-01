# Testing Pitfalls

Test scenario checklist for reviewing coverage of any feature. Every item on this list exists because it catches bugs that have occurred in real codebases. Items marked with **🔥 Found in this project** were discovered here specifically. Unmarked items are universal — bugs we haven't made *yet* in this project, but that have bitten other projects hard enough to be worth testing against. Do not deprioritize an unmarked item because it lacks a marker.

> **Relationship to implementation-pitfalls.md:** `implementation-pitfalls.md` specifies *what* to implement and *why*. This document specifies *how to verify* those implementations work correctly. Cross-references between the two are noted inline.

---

## How to Use This Document

**If you're writing tests:** Go to the relevant topic sections below, read the checklist items, and verify your test suite covers each one that applies. Unchecked items are gaps — either add a test or explicitly note why the item doesn't apply to this feature.

**If you're reviewing tests:** Use the checklist to audit coverage gaps. A passing test suite with missing coverage is worse than a failing test suite with complete coverage — you don't know what's actually protected.

**If you're maintaining this document:** When a real bug slips through to production or staging because of a missing test, add the check item to the appropriate section with the 🔥 marker and a one-line note about the observed failure mode. See §How to Add a Testing-Pitfall at the end.

---

## 1. Test Output Pristine

Test output MUST be clean for the suite to pass — no stray errors, warnings, or stack traces. If a test legitimately produces errors (e.g. it's verifying error handling), capture them explicitly and assert on their content. Silent error spam in test output hides real failures.

- [ ] **No unexpected stderr in passing tests.** Any stderr output from a passing test must be explicitly asserted on, or the test is lying about what it verifies.
- [ ] **No unhandled promise rejections / uncaught exceptions.** These often appear as warnings rather than test failures; configure your runner to fail on them.
- [ ] **Deprecation warnings fail the suite or are explicitly tracked.** Silently-warned deprecations become hard breaks on the next runtime upgrade.
- [ ] **Test output doesn't contain debug prints.** Debug statements that escaped into production tests are sometimes the only evidence of a half-finished implementation.

---

## 2. Skipped Tests Are Not Passing Tests

A test that's `skip`ped, `xit`'d, `pending`, or `@Ignore`d is a test that's not running. A CI job that says "100 tests passed, 5 skipped" is NOT the same as "105 tests passed."

- [ ] **No unexplained skips in the suite.** Every skipped test has a comment explaining why it's skipped and under what condition it should be re-enabled.
- [ ] **Skips with a linked issue/ticket.** A skip without follow-up context is forgotten work.
- [ ] **CI distinguishes skipped from passed in its summary.** If the report doesn't separate them, skipped failures hide.
- [ ] **Skip counts are tracked over time.** Growing skip count = eroding coverage.

---

## 3. Error Path Coverage

Silent error swallowing is one of the largest bug categories in any codebase. Every error path must be tested explicitly — not just "the happy path works."

- [ ] **Each error branch has a test that triggers it.** If a function has 5 ways to return an error, there are 5 tests covering each one.
- [ ] **Error messages are asserted, not just error presence.** `expect(err).toBeTruthy()` doesn't catch "wrong error returned"; `expect(err.message).toMatch(/expected pattern/)` does.
- [ ] **Information leakage via error codes checked.** When a handler must return the same status code regardless of whether a resource exists (anti-enumeration), test that ALL error paths return the same status — including DB errors on post-lookup queries that leak existence.
- [ ] **Error-path side effects verified.** If an error path is supposed to roll back state / release a lock / clear a cache, assert that it did.
- [ ] **Error-path resource cleanup verified.** Acquired resources (file handles, DB connections, semaphores) must be released even on error. Test with `defer`-equivalent patterns or explicit cleanup assertions.
- [ ] **Partial failure of a multi-write sequence is tested at each step.** For any sequence that destroys state before recreating it, inject a failure at every write and assert the caller is left recoverable. A suite that only covers "the write works" and "the input was invalid" never touches the interrupted-success path. **🔥 Found 2026-08-01:** refresh rotation does `DELETE ... RETURNING` then `INSERT`s a replacement (`src/lib/auth.ts:115-159`); a throw on the insert permanently destroys a 90-day session and escapes every route's `try` block, because `authenticateRequest` is called before it. Same shape in the match route, where a D1 failure after the billed Anthropic call discards a paid round (`src/app/api/movie-sessions/[id]/match/route.ts:154-165`).

---

## 4. Negative Property Testing

Happy-path tests prove "it works" for one input. Negative property tests prove "it doesn't break" under stress, boundaries, and adversarial input. The latter catches the bugs that ship.

- [ ] **Cleanup and eviction.** When code accumulates state (maps, caches, queues), test that stale entries are eventually cleaned up. Don't just test "it works" — test "it doesn't leak."
- [ ] **Bounded growth.** For any in-memory data structure that grows with external input, test that it has a maximum size or eviction policy. Simulate 1000+ entries and verify memory is bounded.
- [ ] **Case sensitivity where identity matters.** When a string key is used for identity (email, username, path), test that case variations are treated consistently. `Admin@Example.com` and `admin@example.com` must be the same identity — or consistently different ones.
- [ ] **Empty / null / zero inputs.** Every parameter that accepts a value should be tested with empty string, null, zero, empty array, empty map. "Did not crash" is not the same as "handled correctly."
- [ ] **Oversized inputs.** Long strings, deeply nested structures, large collections. Where are your truncation / rejection boundaries, and are they enforced?
- [ ] **Unicode / encoding edge cases.** Multi-byte chars, combining sequences, RTL text, emoji, zero-width joiners, NUL bytes. Anywhere strings cross a boundary (storage, display, comparison) needs this.
- [ ] **Truncation direction is asserted, not just the cap.** When a list is capped, test past the cap and assert *which* entries survive — and name in the test why those are the ones that matter. A fixture numbered in ascending order makes "the first N survive" look self-evidently right. **🔥 Found 2026-08-01:** the accumulated removed-titles list is built oldest-first and sliced `[0,50]` (`src/lib/matching.ts:185-187`), so past 50 exclusions the films the user just rejected are the ones dropped — while the client slices `[-50]` and keeps the opposite end. The existing cap test passes while asserting the wrong direction.
- [ ] **Repeat invocations of a batch job make forward progress.** Run any "process the N stalest records" job twice against a dataset larger than N and assert the second run touches different records. Single-run tests prove the right N were picked *this* time, which is not the same claim. **🔥 Found 2026-08-01:** the weekly refresh orders by `popularity DESC LIMIT 200` over a ~1000-title catalog and writes `last_refreshed_at` only on success (`src/lib/cron-handler.ts:25-32, 78-80`), so popular titles that always fail — and, whenever cron jitter re-qualifies them, the whole top 200 — hold the same slots week after week while the tail is never refreshed.

---

## 5. Concurrency & TOCTOU

If the code can be executed concurrently, test it concurrently. Single-threaded happy-path tests don't catch race conditions.

- [ ] **Multi-step flows under concurrent access.** When a flow reads state then writes state (check-then-act), test two callers racing through the same flow simultaneously. Use a barrier / sync primitive to ensure they hit the critical section at the same time — `WaitGroup` / `Promise.all` alone doesn't guarantee simultaneity.
- [ ] **"Use once" tokens consumed correctly.** Any token that should be single-use (password reset, verification code, invitation) must be tested with two concurrent consumers. Exactly one must succeed.
- [ ] **Rate-limit enforcement under concurrency.** Count-then-insert rate limits can be bypassed by concurrent requests that all read the same count before any insert. Test with burst requests.
- [ ] **Idempotency under retry/concurrency.** If an operation should be idempotent (accepting an invitation twice, retrying a failed payment), test concurrent execution — the second attempt must not produce a 500 from a constraint violation.
- [ ] **Bootstrap / first-time races.** First-user, first-org, or any "only if none exist" flow tested with concurrent attempts. Exactly one must win.
- [ ] **The *loser* of a single-use claim is asserted, not just the winner.** "Exactly one succeeds" is half the contract; assert what the other caller receives and that it is distinguishable from a genuinely-failed request. Then enumerate the client's request fan-out — every `Promise.all` of authenticated fetches — and check that N−1 of them losing is acceptable. **🔥 Found 2026-08-01:** the loser of a refresh-token rotation race returns `{ user: null }` (`src/lib/auth.ts:120-125`), which every route renders as a 401 and every page turns into a redirect to the landing screen. `/ritual` fires three such requests at once and `/profile` two, so any client-side navigation after the 15-minute session-cookie window dead-ends on an error screen. The existing test asserts the cookie half of that branch and stops.

> **Harness limitation — read before writing anything in this section.** `src/test/fake-d1.ts` is backed by `node:sqlite`'s synchronous `DatabaseSync` and cannot interleave two callers, so none of the concurrency items above are currently provable in the unit suite — including "Bootstrap / first-time races", which `createSoloGroup` (`src/lib/movie-sessions.ts:24-46`) would fail. Closing them needs either an async-capable fake with an injectable yield point between statements, or Miniflare-backed integration tests. Until then, treat these items as review checks, not test checks, and say so rather than marking them covered.

---

## 6. Boundary & Configuration Validation

Configuration errors, bad boundaries, and missing validation are a surprisingly large portion of production incidents. Test the edges.

- [ ] **Default values are tested.** What does the code do when a config value is absent? Crash? Use a default? Silently use zero? All three are possible; the right behavior needs a test.
- [ ] **Falsy-but-valid config values are tested, not just absent ones.** `0` and `""` are legitimate settings that `||`-style defaulting silently discards, and they are usually the values an operator reaches for in an incident. Testing "absent" and "some truthy value" leaves the dangerous case between them untested. **🔥 Found 2026-08-01:** `Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || 2000` (`src/app/api/movie-sessions/[id]/match/route.ts:105`) turns the spend kill switch `MONTHLY_MATCH_LIMIT=0` back into the default 2000-call allowance. Use `?? DEFAULT` with an explicit `Number.isNaN` check.
- [ ] **Invalid config is rejected at load time.** A system that loads invalid config, then crashes on first use of it, surfaces the error too late. Test that config validation runs at load.
- [ ] **Environment-specific behavior.** If code behaves differently in dev vs. prod (feature flags, degraded modes), test both paths. Don't assume dev-tested code works in prod.
- [ ] **Feature flag flip behavior.** Test both flag-on and flag-off paths. A feature behind a flag that's never tested with the flag off can't be safely rolled back.
- [ ] **Timeout and retry boundaries.** If a caller retries 3 times with 5s timeouts, test what happens on the 4th call and on a request that takes 4.9s. The edges matter.

---

## 7. Test Infrastructure Hygiene

The test suite itself is code. It decays if not maintained. Messy test infrastructure produces flaky tests, which produce lost confidence, which produce skipped tests (see §2).

- [ ] **No shared mutable state between tests.** Each test should set up its own state and tear it down. Tests that depend on previous tests' state are order-dependent and flaky.
- [ ] **Setup / teardown covers the failure case.** If setup partially succeeds then teardown fails, the next test starts from a corrupted state. Teardown must be robust to partial-setup states.
- [ ] **Test doubles are minimal and honest.** A mock that returns fixed data is testing the mock, not the code. Use real implementations where feasible; mock only external boundaries.
- [ ] **A fake enforces the real dependency's limits, not just its happy path.** When a fake is more permissive than production, every test passes while production rejects the same call. **🔥 Found in Phase 8:** the fake D1 (backed by `node:sqlite`, `SQLITE_MAX_VARIABLE_NUMBER`=999) silently accepted 200-parameter `IN (...)` queries that real D1 rejects at 100, so the entire suite proved the core match path worked while it would 500 in production for any couple with full profiles. `src/test/fake-d1.ts` now throws at 100 bound params. When a fake stands in for a service with documented hard limits (parameter counts, payload sizes, row limits), encode those limits in the fake.
- [ ] **Fixtures reproduce states the real client actually produces — not impossible ones.** A test that hand-assembles a state the real caller can never emit proves nothing about production. **🔥 Found in Phase 8:** every auth refresh test sent an expired-session cookie *and* a refresh cookie together, but a real browser deletes the session cookie at its `Max-Age` (tied to the 15m JWT) and afterward sends only the refresh cookie — the state that made the refresh path unreachable. Assert on cookie *lifetimes and presence combinations* a real client yields, not just cookie values.
- [ ] **No hardcoded time-of-day or timezone assumptions.** Tests that pass at 09:00 UTC but fail at 23:00 UTC are flaky by design. Use injected clocks for time-sensitive tests.
- [ ] **No network calls in unit tests.** A unit test that hits a real API is an integration test with a misleading name. Either mock the boundary or move it to the integration suite.

---

## 8. Cross-Table Lifecycle & Authorization Freshness

Membership, identity and history live in different tables with different lifecycles. A mutation on one table is easy to test in isolation and passes; the bug is always in a *reader* keyed on a table the mutation didn't touch. Test the mutation AND every downstream read.

- [ ] **Authorization is re-tested after the granting relationship is revoked.** For every route that authorizes off a historical join record, add a test that revokes the live relationship and asserts the route now refuses. **🔥 Found 2026-08-01:** `POST /api/movie-sessions/[id]/match` authorizes purely off `session_members`, which `leaveGroup` deliberately preserves — so an ex-member keeps generating fresh taste maps from the remaining members' current profiles.
- [ ] **Read access and write/spend access are tested separately after revocation.** Preserving history for a departed member is often intended; letting them trigger new work on the account owner's budget is not. Assert the two independently — a single "can they still see it?" test conflates them.
- [ ] **Every reader keyed on a surviving key is asserted after a mutation deletes or anonymizes rows.** For each row a mutation removes or rewrites, grep for every query that still joins, counts, or renders on the surviving key, and assert the post-mutation read — not just the mutation's own effect. **🔥 Found 2026-08-01, three times over:** account deletion anonymizes `session_members.user_id` but leaves the deleted user's real name in `recommendations.ai_response`, which the session GET re-serves verbatim; the same anonymized rows keep inflating `getSessionForMember`'s `member_count`, so a session reports `solo: false` while one member reaches the prompt; and the `groups` row itself is never removed, leaving a still-joinable ownerless group. All three mutations had passing, complete unit tests.

---

## How to Add a Testing-Pitfall

When a bug reaches production (or staging, or late integration testing) because a test was missing:

1. **Identify the topic section** the missing test belongs in. If none of sections 1-7 fit, add a new numbered topic section.
2. **Write the check item** as a `- [ ]` checkbox. Lead with a bolded imperative ("**X is tested.**"), then one sentence explaining what the check covers and why.
3. **Mark with the 🔥 marker** if the bug was found in this project's own history: `**🔥 Found in [context]:** one-line note about the observed failure mode`.
4. **Cross-reference implementation-pitfalls.md** if there's a corresponding implementation entry.
5. **Resist the urge to be clever.** "Tests X under condition Y" is better than a novel testing philosophy. These are pass/fail checklist items, not essays.

The test suite is the enforcement mechanism for this document. If you add a check item and don't write the corresponding test, you've documented a gap, not closed one. Close it.
