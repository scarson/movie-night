# Bug Hunt Report — Movie Night Phase 1 (multi-pass)

**Date:** 2026-08-01
**Checkout:** `/Users/sam/Code/movie-night/.claude/worktrees/bug-hunt-2026-08-01` (origin/dev @ 382394e)
**Method:** `code-bug-hunter-multipass` — five focused passes.

## Scope

All non-test source under `src/`, plus adjacent code the source must agree with:

- `src/lib/` — `auth.ts`, `db.ts`, `groups.ts`, `matching.ts`, `movie-sessions.ts`, `account.ts`, `cron-handler.ts`, `tmdb.ts`, `session-flow.ts`
- `src/app/api/` — auth (google, callback, logout, me), groups (list/create, join, `[id]`, `[id]/leave`), movie-sessions (create, `[id]`, `[id]/match`), titles/search, user (profile, account)
- `src/app/` pages — `results/[sessionId]`, `tonight`, `quick`, `ritual`, `groups`, `groups/join/[code]`, `profile`
- `src/components/` — taste-map, ranked-list, conversational-view, bold-text, refine-panel, poster, group-picker, mood-screen, rough-day-toggle, tag-picker, title-search, profile-editor, phased-loading, auth-provider
- `src/types/` (`db.ts`, `matching.ts`), `src/config/tags.ts`
- Adjacent: `migrations/0001_initial_schema.sql`, `worker.ts`, `wrangler.jsonc`, `env.d.ts`, `scripts/seed-lib.ts`, `scripts/seed.ts`

Intent context read first: `dev/plans/design-doc.md`, `docs/pitfalls/implementation-pitfalls.md` (PLAT-1), `CLAUDE.md` §Gotchas.
No test files were read as evidence (`src/test/fake-d1.ts` was consulted only to establish the D1 bound-parameter boundary the production code is judged against).

**Passes performed:** all five — (1) contract violations, (2) cross-sibling pattern violations, (3) failure-mode reasoning, (4) concurrency reasoning, (5) error propagation.

**Excluded by instruction (not reported as bugs):** the two accepted check-then-act races — group-join rate limit (`src/app/api/groups/join/route.ts:41-53`) and match round limit (`src/app/api/movie-sessions/[id]/match/route.ts:92-103`).

---

## Bugs

### 1. Leaving a group does not revoke matching authority over that group's sessions

**Location:** `src/lib/movie-sessions.ts:164-190` (`getSessionForMember`), `src/lib/groups.ts:173-178` (`leaveGroup`), `src/app/api/movie-sessions/[id]/match/route.ts:87-90`
**Severity:** significant
**Found in:** Pass 1 — contract violations (confirmed via Pass 3)

**Evidence.** `leaveGroup` deletes only the `group_members` row:

```sql
DELETE FROM group_members WHERE group_id = ? AND user_id = ?
```

Every authorization decision on a session is made against `session_members`, not against current group membership:

```sql
FROM movie_sessions ms
JOIN session_members sm ON sm.session_id = ms.id AND sm.user_id = ?
WHERE ms.id = ?
```

`session_members` rows are deliberately preserved on leave (design doc §"Leaving a group"), so an ex-member still passes `getSessionForMember` forever. `POST /api/movie-sessions/[id]/match` gates on exactly that check and nothing else, then calls `getSessionMembersWithProfiles(db, id)` (`src/lib/movie-sessions.ts:225-260`), which reads every member's **current** `profiles` row and produces a fresh taste map naming them.

**Impact.** Someone removed from (or who walked out of) a group can keep running new matching rounds on any old session of that group — up to the 10-round budget, on the account owner's Anthropic spend — and each round returns a newly generated analysis of the remaining members' *current* comfort films, watchlist, vibes and dealbreakers. The design doc's privacy principle is "Taste profiles are not visible to anyone outside the user's group." Preserving *read access to history* is intended; re-deriving a new analysis from live profile data after leaving is not. The obvious break-up scenario is exactly the one this fails.

**Fix direction:** gate the match POST (not the read-only session GET) on current `group_members` membership as well as `session_members`.

---

### 2. Accumulated "never recommend again" list is truncated to the 50 **oldest** exclusions

**Location:** `src/lib/matching.ts:20` (`MAX_TITLE_LIST_ENTRIES = 50`), `src/lib/matching.ts:185-187` (`clampTitleList`), `src/lib/matching.ts:233-234`; producer at `src/app/api/movie-sessions/[id]/match/route.ts:117-119, 146`
**Severity:** significant
**Found in:** Pass 1 — contract violations

**Evidence.** The route builds the exclusion set accumulated-first, newest-last:

```ts
const allRemovedIds = [
  ...new Set([...(await getAccumulatedRemovedIds(db, id)), ...removedTmdbIds]),
];
```

and passes it to the prompt builder, which slices from the **front**:

```ts
function clampTitleList(titles: string[]): string[] {
  return titles.slice(0, MAX_TITLE_LIST_ENTRIES);   // keeps the first 50
}
```

Nothing else enforces exclusion: `selectCandidates` (`src/lib/matching.ts:80-150`) filters on dealbreaker genres and (in discovery mode) member-referenced titles, but never on removed ids. The prompt line is the only mechanism.

The 50-entry ceiling is reachable inside the 10-round budget: each round returns 5-7 recommendations and the user may remove all of them, and the route itself accepts up to 50 removed ids *per request* (`MAX_ID_LIST_ENTRIES = 50`). Past ~8 rounds of heavy rejection the union exceeds 50.

Note the client truncates in the opposite direction — `src/app/results/[sessionId]/page.tsx:221-223` uses `.slice(-MAX_ID_LIST_ENTRIES)`, keeping the **newest** — so the two layers disagree about which end is expendable.

**Impact.** Once the accumulated list passes 50, the films the user just rejected are precisely the ones dropped from the prompt's exclusion list, and they can come back in the next round. The design doc states: "Removed movies are permanently excluded (accumulated across rounds, never return)." The failure is silent and appears only to the couples who iterate the most.

---

### 3. Weekly refresh starves the catalog's long tail — most titles are never refreshed after seeding

**Location:** `src/lib/cron-handler.ts:10` (`STALE_TITLES_LIMIT = 200`), `src/lib/cron-handler.ts:25-32`; catalog size at `scripts/seed.ts:19` (`DEFAULT_PAGES = 50`); schedule at `wrangler.jsonc` `"crons": ["0 9 * * 1"]`
**Severity:** significant
**Found in:** Pass 3 — failure-mode reasoning

**Evidence.**

```sql
SELECT tmdb_id, content_type FROM titles
WHERE last_refreshed_at IS NULL OR last_refreshed_at < strftime(... '-7 days')
ORDER BY popularity DESC
LIMIT 200
```

The seed writes `last_refreshed_at = now` for every row (`scripts/seed-lib.ts:69-90`), and the default seed is 50 discover pages ≈ 1000 titles. The cron fires once a week and takes the **top 200 by popularity** among rows stale by ≥7 days. Those same 200 are stale again the following Monday (their `last_refreshed_at` is exactly one week old, and the comparison is strict `<`), so they win the ordering again. Titles ranked 201+ satisfy the staleness predicate every single week and are never selected.

**Impact.** For roughly 80% of the catalog, `streaming`, `popularity`, `vote_count` and `vote_average` are frozen at seed time forever. The ranked list surfaces this to users: `asOfNote` (`src/components/ranked-list.tsx:35-42`) starts printing "as of <seed date>" on those picks after a fortnight and never stops. The design doc's success criterion — "Recommendations include 'where to watch' info that's actually correct" — degrades permanently, and `popularity` (the sole ordering key for `selectCandidates`' pool) also goes stale for the tail.

**Fix direction:** order by `last_refreshed_at ASC` (oldest first) so the cursor sweeps the whole catalog, or split the budget between "most popular" and "least recently refreshed".

---

### 4. A transient D1 write failure during refresh-token rotation destroys the 90-day session and escapes every route's error handling

**Location:** `src/lib/auth.ts:113-125` (claim) and `src/lib/auth.ts:146-159` (re-issue)
**Severity:** significant
**Found in:** Pass 3 — failure-mode reasoning

**Evidence.** Rotation is a two-step sequence with no compensating action:

```ts
const claimed = await db
  .prepare("DELETE FROM sessions WHERE token_hash = ? RETURNING user_id, expires_at")
  .bind(tokenHash).first<...>();
// ... later ...
await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
  .bind(newTokenHash, userId, expiresAt, now).run();
```

If the `INSERT` (or the intervening `SELECT email FROM users`) throws — D1 overload, "requests queued for too long", any 5xx from the storage layer — the old session row is already gone and the new one was never written. The exception then propagates out of `authenticateRequest`, which **every** route calls *before* its `try` block (e.g. `src/app/api/movie-sessions/[id]/match/route.ts:61`, `src/app/api/user/profile/route.ts:62`, `src/app/api/groups/route.ts:14`). Nothing catches it, and no `Set-Cookie` clears the now-dead cookies.

**Impact.** One transient D1 blip during a token rotation permanently signs the user out — their 90-day refresh token no longer exists in `sessions`, but the browser keeps sending it, so every subsequent request takes the "session not found, don't clear cookies" branch (`src/lib/auth.ts:120-125`) and returns 401 forever until the user manually clears cookies. The user also sees a raw framework 500 rather than the route's JSON error, because the throw happens outside the handler's `try`.

---

### 5. Concurrent requests sharing one refresh token: the losers get a 401 with no retry

**Location:** `src/lib/auth.ts:113-125`
**Severity:** significant
**Found in:** Pass 4 — concurrency reasoning

**Evidence.** The `DELETE ... RETURNING` is a deliberate single-winner claim. The losing caller returns `{ user: null }`:

```ts
if (!claimed) {
  // Session not found — either already claimed by a concurrent request,
  // or the token was never valid. Don't clear cookies: ...
  return { user: null, headers };
}
```

The comment shows the cookie-clearing half of the race was handled; the response half was not. The loser is indistinguishable from an unauthenticated request and gets a 401. There is no retry, no short grace window on the just-rotated token, and no way for the caller to tell "lost a rotation race" from "not signed in".

This is reachable whenever two requests carrying only `mn-refresh` (i.e. after the 15-minute `Max-Age=900` session cookie has lapsed) are in flight together — most obviously two browser tabs waking at once, both firing `GET /api/auth/me` from `AuthProvider` (`src/components/auth-provider.tsx:32-49`).

**Impact.** One tab renders as signed-out. `AuthProvider` sets `user: null`, and every gated page then does `router.replace("/")` (`src/app/tonight/page.tsx:23-27`, `src/app/results/[sessionId]/page.tsx:93-95`, `ritual`, `quick`, `groups`) — the user is bounced to the landing page mid-session even though their session is perfectly valid. A reload fixes it, which makes it look like a flaky app rather than a bug.

Distinct from the accepted TOCTOU races: this one is not a check-then-act on a limit, it is an atomic claim whose loser is misreported as unauthenticated.

---

### 6. `createSoloGroup` can create duplicate `__solo__` groups for one user

**Location:** `src/lib/movie-sessions.ts:24-46`; schema has no supporting constraint (`migrations/0001_initial_schema.sql:34-48`)
**Severity:** minor
**Found in:** Pass 4 — concurrency reasoning

**Evidence.** Classic check-then-insert with no uniqueness backstop:

```ts
const existing = await db.prepare(
  `SELECT g.id FROM groups g JOIN group_members gm ON gm.group_id = g.id
   WHERE gm.user_id = ? AND g.name = ?`).bind(userId, SOLO_GROUP_NAME).first();
if (existing) return existing.id;
const groupId = crypto.randomUUID();
await db.batch([ /* INSERT groups ... INSERT group_members ... */ ]);
```

`groups` is unique on `invite_code` only, and each call generates a fresh `solo-<uuid>` code, so both concurrent inserts succeed. Two solo sessions started in quick succession (double-tap on "Find our match →", or two tabs) each produce a distinct `__solo__` group.

**Impact.** The user's solo history splinters across multiple hidden groups. No user-visible breakage today because solo groups are never listed (`getGroupsForUser` excludes them), but any Phase-2 feature keyed on `group_id` — watch history, tension axes, "Our Movie Nights" timeline — will silently see a fragmented history.

---

### 7. The taste map's weighting note is shown even when the engine applied no weighting

**Location:** `src/app/results/[sessionId]/page.tsx:346-351` vs `src/lib/matching.ts:204-218`
**Severity:** minor
**Found in:** Pass 1 — contract violations

**Evidence.** The engine cancels the weighting when everyone toggled:

```ts
const toggledCount = members.filter((m) => m.roughDay).length;
if (toggledCount === 0 || toggledCount === members.length) {
  return "No preference weighting — treat all profiles equally.";
}
```

The UI derives the note purely from the viewer's own flag and the member count:

```tsx
showWeightingNote={session.roughDay && response.tasteMap.members.length > 1}
```

and renders "At your request, tonight's picks lean toward everyone else." (`src/components/taste-map.tsx:192-201`).

**Impact.** When both people in a couple toggle rough-day — which the design explicitly anticipates ("If both toggle it, weights cancel") — each is told their generosity was applied when the prompt explicitly instructed the model to treat all profiles equally. The note is a factual claim about what the engine did, and in that case it is false. Fixing it needs the session view to carry the *group's* toggle count (a scalar, not per-member flags, so it leaks nothing).

---

### 8. Defensive response validation checks `tasteMap.members` but not `tasteMap.overlap`, which consumers dereference unconditionally

**Location:** `src/lib/matching.ts:346-357` vs `src/components/taste-map.tsx:89, 164, 166, 174`
**Severity:** minor
**Found in:** Pass 5 — error propagation

**Evidence.** The guard stops one field short:

```ts
if (
  shaped === null || typeof shaped !== "object" ||
  typeof shaped.conversational !== "string" ||
  !Array.isArray(shaped.recommendations) ||
  shaped.tasteMap === null || typeof shaped.tasteMap !== "object" ||
  !Array.isArray(shaped.tasteMap.members)
) { throw new MatchingError("malformed"); }
```

`tasteMap.overlap` is never checked. The only consumer destructures and dereferences it with no guard:

```tsx
const { members, overlap } = tasteMap;
... {overlap.summary} ... {overlap.sharedVibes.length > 0 && ...} ... {overlap.tensionPoints.length > 0 && ...}
```

Same for `MemberTaste.primaryVibes` / `genreAffinities` (`src/components/taste-map.tsx:66, 70`).

**Impact.** A response that is valid JSON, has the right top-level shape, but is missing `overlap` sails past validation, gets **persisted** to `recommendations.ai_response`, and then throws in React render — a blank results tab. Because it was stored, the crash is reproduced on every subsequent reload of that session via `GET /api/movie-sessions/[id]`, which re-serves it (`src/app/api/movie-sessions/[id]/route.ts:38`). The whole point of the `malformed` kind is that it retries once and then degrades gracefully; this path skips both. Structured outputs make it unlikely, not impossible — and the file's own comment says "parse defensively anyway", so the intent is explicit.

---

### 9. A paid matching round is discarded when persistence or title hydration fails

**Location:** `src/app/api/movie-sessions/[id]/match/route.ts:154-165`
**Severity:** minor
**Found in:** Pass 3 — failure-mode reasoning

**Evidence.** After `runMatching` returns (the Anthropic call has completed and been billed):

```ts
await insertRecommendation(db, { ... });
const titles = await getTitlesMap(db, response.recommendations.map((rec) => rec.tmdbId));
return withAuthHeaders(NextResponse.json({ round, response, titles }), headers);
```

Both awaits are inside the outer `try`, whose only non-`MatchingError` branch is `500 "Match failed"`.

- If `insertRecommendation` throws, the model's response is lost entirely — nothing is written, the user sees a generic failure, and a retry pays for a whole new call.
- If the second `getTitlesMap` throws, the round **was** persisted (so the round budget is consumed and `getAccumulatedRemovedIds` will include it) but the client is told the round failed. `runRound` (`src/app/results/[sessionId]/page.tsx:122-143`) then leaves `carriedRemoved` un-updated, so the client's exclusion state desyncs from the server's.

**Impact.** Money and state are lost on a D1 hiccup at the last step of the most expensive path in the app. The response is in memory and could be returned with an empty/partial `titles` map — `RankedList` already handles a missing title (`src/components/ranked-list.tsx:129-132`).

---

### 10. `MONTHLY_MATCH_LIMIT=0` silently becomes 2000 — the kill switch cannot be set to zero

**Location:** `src/app/api/movie-sessions/[id]/match/route.ts:105`
**Severity:** minor
**Found in:** Pass 1 — contract violations

**Evidence.**

```ts
const monthlyLimit = Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || DEFAULT_MONTHLY_MATCH_LIMIT;
```

`Number.parseInt("0", 10)` is `0`, which is falsy, so `||` substitutes `2000`.

**Impact.** The design doc specifies a hard cap "that disables the matching endpoint rather than running up an unbounded bill". The natural way to disable it under a runaway-spend incident — set the secret to `0` — does the exact opposite of what the operator intends, restoring the default 2000-call allowance. `?? DEFAULT` with an explicit `Number.isNaN` check is the correct form.

---

## Design Concerns

Patterns that raise bug risk without being defects today.

- **`resolveIds` sits exactly on D1's bound-parameter ceiling with zero headroom.** `src/app/api/titles/search/route.ts:53-65` builds `IN (${placeholders})` from up to `MAX_RESOLVED_IDS = 100` ids and binds all of them, while its siblings (`getTitlesMap`, `selectCandidates`) both route through `chunk(ids, D1_IN_CHUNK_SIZE=90)` per PLAT-1. 100 is the documented maximum, so today it passes — but the cap is derived from "comfort (≤50) + watchlist (≤50)", and any future fixed parameter added to that statement, or any bump to the profile list limits, breaks it in production only. This is the one remaining unchunked dynamic `IN (...)` in the codebase; it should use the same helper as its siblings.
- **`rate_limit_log` is append-only and never pruned.** `src/lib/groups.ts:194-199` inserts a row per join attempt; nothing deletes rows older than the 10-minute window. The table grows without bound and the `idx_rate_limit_scope_key` index degrades over time.
- **Profile PUT does an N+1 existence check.** `src/app/api/user/profile/route.ts:120-126` runs one `SELECT 1 FROM titles` per referenced id — up to 100 sequential D1 round-trips inside a single request, on the ritual's "Continue" button. One chunked `IN (...)` would replace the whole loop.
- **TMDB synopsis text reaches the CANDIDATES prompt block un-delimited.** `firstSentence` (`src/lib/matching.ts:193-196`) falls back to `clampText(text, 160)` when the overview has no `.`/`!`/`?` terminator, and that fallback can contain newlines — which lets a synopsis inject additional lines into the pipe-delimited candidate list. TMDB overviews are community-editable. The prompt's guardrail (`src/lib/matching.ts:226-227`) names only "the profile data below", so candidate text is outside its stated scope. Strip newlines in `firstSentence` and extend the guardrail to cover the candidate block.
- **Account deletion does not scrub names from stored AI responses.** `deleteAccount` (`src/lib/account.ts:4-17`) randomizes `session_members.user_id` and anonymizes `movie_sessions.initiated_by_user_id`, but `recommendations.ai_response` holds a full `tasteMap` with the deleted user's `name` and `userId`, and that JSON is re-served verbatim by `GET /api/movie-sessions/[id]` to every remaining member. The privacy policy promises the deleted user's identity is replaced with "[deleted user]".
- **Orphaned groups accumulate.** Neither `deleteAccount` nor `leaveGroup` removes a `groups` row that has lost its last member; `leaveGroup` also has no guard against a `__solo__` group id, so a user can leave their own personal group and strand its session history (a fresh one is silently created on the next solo session).
- **Client and server truncate the same list from opposite ends.** `src/app/results/[sessionId]/page.tsx:221-223` keeps the newest 50 (`.slice(-50)`); `src/lib/matching.ts:186` keeps the oldest 50 (`.slice(0, 50)`). This disagreement is the mechanism behind Bug 2 and will resurface anywhere else a bounded list crosses that boundary.
- **Input caps are enforced only server-side, so the ritual fails late.** `TagPicker` (`src/components/tag-picker.tsx:37-47`) and `TitleSearch` (`src/components/title-search.tsx:79-85`) impose no count limit, while `PUT /api/user/profile` rejects >30 tags per list and >50 titles per list (`src/app/api/user/profile/route.ts:33-47`). A user can fill in 60 comfort films and only learn on "Continue" that the save was refused. Same shape for `MAX_UNKNOWN_IDS_PER_PUT = 10`: adding 11 titles absent from the local catalog produces a 400 with no in-form signal.
- **Cron failures are invisible.** `worker.ts:15-17` calls `ctx.waitUntil(runWeeklyRefresh(env))` with no `.catch`; if the stale-titles `SELECT` throws, the rejection escapes and no `cron_refresh` log line is ever emitted, so the run's absence is the only signal.

---

## Notes on what was checked and found correct

Recorded so a later hunt doesn't re-litigate them:

- **PLAT-1 chunking** is correctly applied in `getTitlesMap` (`src/lib/movie-sessions.ts:278`) and `selectCandidates`' referenced-id lookup (`src/lib/matching.ts:101`).
- **No `datetime()` in comparisons.** `sqliteIsoNow()` is used in `groups.ts:185` and `cron-handler.ts:28`; `countMatchesThisMonth` uses an explicit `strftime('%Y-%m-01T00:00:00Z','now')` that compares correctly against JS `toISOString()` values.
- **XSS.** No `dangerouslySetInnerHTML` anywhere. `parseBold` (`src/components/bold-text.tsx:13-26`) handles balanced, unbalanced, leading and trailing markers correctly and emits React text nodes only.
- **Seed SQL injection.** `sqlQuote`/`sqlInt`/`sqlFloat` (`scripts/seed-lib.ts:21-40`) correctly neutralize hostile TMDB fields; the 17 columns and 17 values in `titleToInsertStatement` line up.
- **Rough-day privacy through the engine.** `computeWeightNote` names a favored member only when exactly one is favored, and `SessionView.roughDay` (`src/lib/movie-sessions.ts:156-157, 204`) serializes the requester's own flag only. `getSessionMembersWithProfiles` is never serialized to a response.
- **Recommendation dedup and id validation** in `parseMatchingResponse` (`src/lib/matching.ts:359-376`) — unknown `tmdbId`s are dropped and reported, duplicates collapsed, `matchScore` clamped.
- **`callClaude` ordering** — `APIConnectionError` is tested before `APIError`, and `stop_reason` is branched on before text extraction; the text block is located by `.find(type === "text")` rather than `content[0]`.
- **OAuth `returnTo`** — `validateReturnTo` plus `new URL(returnTo, request.url)` closes the open-redirect path, including via the invite-code segment on `/groups/join/[code]`.

---

## Recommended additions to `docs/pitfalls/testing-pitfalls.md`

This hunt was dispatched analysis-only, so `testing-pitfalls.md` was **not** edited. The items below are tied to specific findings above and are ready to paste into the named sections.

**§3 Error Path Coverage** — strengthen the existing "Error-path side effects verified" item, or add:

- [ ] **Partial failure of a multi-write sequence is tested at each step.** For any sequence that destroys state before recreating it, inject a failure at every write and assert the caller is left recoverable. **🔥 Found 2026-08-01:** refresh rotation `DELETE ... RETURNING` then `INSERT`s a replacement (`src/lib/auth.ts:113-159`); a throw on the insert permanently destroys a 90-day session and escapes every route's `try` block, because `authenticateRequest` is called before it.

**§4 Negative Property Testing** — add:

- [ ] **Truncation direction is asserted, not just the cap.** When a list is capped, test past the cap and assert *which* entries survive. **🔥 Found 2026-08-01:** the accumulated removed-titles list is built newest-last and sliced `[0,50]` (`src/lib/matching.ts:186`), so past 50 exclusions the films the user just rejected are the ones dropped — while the client slices `[-50]` and keeps the opposite end. A "cap is enforced" test passes on both.
- [ ] **Repeat invocations of a batch job make forward progress.** Run any "process the N stalest records" job twice against a dataset larger than N and assert the second run touches *different* records. **🔥 Found 2026-08-01:** the weekly refresh orders by `popularity DESC LIMIT 200` over a ~1000-title catalog (`src/lib/cron-handler.ts:25-32`), so the same 200 titles are refreshed every week forever and 80% of the catalog is never refreshed. A single-run test passes.

**§5 Concurrency & TOCTOU** — strengthen the existing "'Use once' tokens consumed correctly" item:

- [ ] **The *loser* of a single-use claim is asserted, not just the winner.** "Exactly one succeeds" is half the contract; assert what the other caller receives and that it is distinguishable from a genuinely-unauthenticated request. **🔥 Found 2026-08-01:** the loser of a refresh-token rotation race returns `{ user: null }` (`src/lib/auth.ts:120-125`), which every route renders as a 401 and every page turns into a redirect to the landing screen — two tabs waking after 15 minutes sign one of them out.

> Note for whoever writes these: `src/test/fake-d1.ts` is synchronous and cannot interleave two callers, so the §5 items above (and the existing "Bootstrap / first-time races" item, which `createSoloGroup` would fail) are not currently provable in the unit suite. Closing them needs either an async-capable fake with an injectable yield point between statements, or Miniflare-backed integration tests.

**§6 Boundary & Configuration Validation** — strengthen "Default values are tested":

- [ ] **Falsy-but-valid config values are tested, not just absent ones.** `0` and `""` are legitimate settings that `||`-style defaulting silently discards. **🔥 Found 2026-08-01:** `Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || 2000` (`src/app/api/movie-sessions/[id]/match/route.ts:105`) turns the spend kill switch `MONTHLY_MATCH_LIMIT=0` back into the default 2000-call allowance.

**New topic section (replaces the §8 TODO placeholder) — Authorization Freshness:**

- [ ] **Authorization is re-tested after the granting relationship is revoked.** For every route that authorizes off a historical join record, add a test that revokes the live relationship and asserts the route now refuses. **🔥 Found 2026-08-01:** `POST /api/movie-sessions/[id]/match` authorizes purely off `session_members`, which `leaveGroup` deliberately preserves — so an ex-member keeps generating fresh taste maps from the remaining members' current profiles.
- [ ] **Read access and write/spend access are tested separately after revocation.** Preserving history for a departed member is often intended; letting them trigger new work on the account owner's budget is not. Assert the two independently.
