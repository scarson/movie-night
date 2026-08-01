# Bug Hunt Report — Phase 1 (holistic)

**Date:** 2026-08-01
**Worktree:** `/Users/sam/Code/movie-night/.claude/worktrees/bug-hunt-2026-08-01` (origin/dev @ `382394e`)
**Method:** `code-bug-hunter-holistic` — read every non-test source file under `src/`, plus
`migrations/0001_initial_schema.sql`, `worker.ts`, `wrangler.jsonc`, `env.d.ts`, `scripts/`,
and `src/test/fake-d1.ts`, then reasoned across the whole picture.

## Scope

Read in full:

- `src/lib/*.ts` — `auth`, `db`, `groups`, `movie-sessions`, `matching`, `tmdb`, `cron-handler`,
  `account`, `session-flow`, `reduced-motion`
- Every route under `src/app/api/` — auth (google, callback, logout, me), groups
  (list/create, join, `[id]`, `[id]/leave`), movie-sessions (create, `[id]`, `[id]/match`),
  titles/search, user (profile, account)
- Every page and layout under `src/app/` and every component under `src/components/`
- `src/types/db.ts`, `src/types/matching.ts`, `src/config/tags.ts`, `src/hooks/use-auth.ts`
- Adjacent: `migrations/0001_initial_schema.sql`, `worker.ts`, `wrangler.jsonc`, `env.d.ts`,
  `scripts/seed.ts`, `scripts/seed-lib.ts`, `src/test/fake-d1.ts`

Intent context read before hunting: `dev/plans/design-doc.md`,
`docs/pitfalls/implementation-pitfalls.md` (PLAT-1), `docs/pitfalls/testing-pitfalls.md`,
`CLAUDE.md` §Gotchas. The Anthropic SDK call in `src/lib/matching.ts` was checked against the
`claude-api` skill: `claude-sonnet-5`, `thinking: {type: "adaptive"}`,
`output_config.effort`, and `output_config.format` with a `json_schema` are all correct for
that model, structured outputs is supported on Sonnet 5, and the
`APIConnectionError`-before-`APIError` ordering in the catch block matches the TypeScript
SDK's class hierarchy. No defect there.

The two ACCEPTED check-then-act races (group-join rate limit, match round limit) are excluded
by instruction and are not reported.

Cookie prefix note: `CLAUDE.md` §Gotchas says `tct-`; the code uses `mn-` consistently
(`mn-session`, `mn-refresh`, `mn-oauth-state`, `mn-oauth-verifier`) and the design doc
specifies `mn-`. The CLAUDE.md line is stale boilerplate carried over from
twin-cities-tee-times, not a code defect.

---

## Bugs

### Concurrent API requests during refresh-token rotation spuriously 401 the whole page

**Location:** `src/lib/auth.ts:113-124`; triggered by `src/app/ritual/page.tsx:75-79` and
`src/app/profile/page.tsx:97`
**Severity:** significant

**Evidence:** `authenticateRequest` claims the refresh token atomically:

```ts
const claimed = await db
  .prepare("DELETE FROM sessions WHERE token_hash = ? RETURNING user_id, expires_at")
  .bind(tokenHash)
  .first<{ user_id: string; expires_at: string }>();

if (!claimed) {
  // Session not found — either already claimed by a concurrent request,
  // or the token was never valid. Don't clear cookies: ...
  return { user: null, headers };
}
```

D1 serializes writes, so of N concurrent requests carrying the same `mn-refresh` cookie exactly
one gets the row. The other N−1 fall into the `!claimed` branch and return `user: null`, which
every route maps to **401**. The comment correctly reasons about not clobbering cookies, but the
losing request still fails.

The `mn-session` cookie is set with `Max-Age=900` (`src/lib/auth.ts:188`), so 15 minutes after
sign-in the browser stops sending it and every request arrives with only `mn-refresh`. The
`AuthProvider` gate (`if (!user) return;` in each page's data effect) serializes the *first*
page load behind `/api/auth/me` — but `AuthProvider`'s effect has an empty dependency array
(`src/components/auth-provider.tsx:32-49`) and the root layout stays mounted across App Router
client navigations, so a `next/link` navigation reuses the cached `user` and never re-authenticates
first.

Concrete path: sign in, sit on `/tonight` for 15+ minutes, click "The full ritual". `/ritual`
fires three requests in parallel:

```ts
const [profile, picks, loadedGroup] = await Promise.all([
  fetchProfileDraft(),      // 401 → null
  fetchQuickPicks(),        // 401 → []
  groupId === null ? … : fetchGroup(groupId),   // 401 → null
]);
```

Two of the three lose the rotation race. `fetchProfileDraft() === null` sets
`"We couldn't load your profile. Reload to try again."` (line 84); `fetchGroup() === null` sets
`"We couldn't load that group. Reload to try again."` (line 88). Either one replaces the entire
ritual with a dead-end error screen. `/profile` has the same two-way race
(`Promise.all([fetchProfileDraft(), fetchQuickPicks()])`) and shows the same
profile-load failure.

**Impact:** The app's primary use case — open it, browse, then start a session — hits a hard
error screen whenever more than 15 minutes elapse between the last request and a client-side
navigation into `/ritual` or `/profile`. It presents as intermittent (a reload succeeds, because
the winner's rotation did land and cookies were never cleared), which makes it easy to
misdiagnose as a network blip. Note the fake D1 is synchronous, so no unit test can reproduce
this.

---

### Accumulated "never recommend again" exclusions silently drop the newest rejections

**Location:** `src/lib/matching.ts:185-187` and `234`; fed by
`src/app/api/movie-sessions/[id]/match/route.ts:117-119, 146`
**Severity:** significant

**Evidence:** The refinement contract in `dev/plans/design-doc.md` §Refinement Loop is
"Removed movies are permanently excluded (accumulated across rounds, never return)".

The match route builds the union of every prior round's removals plus this request's:

```ts
const allRemovedIds = [
  ...new Set([...(await getAccumulatedRemovedIds(db, id)), ...removedTmdbIds]),
];
…
removedTitles: await formatTitleRefs(db, allRemovedIds),
```

`getAccumulatedRemovedIds` (`src/lib/movie-sessions.ts:125-135`) reads
`SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ?` with **no `ORDER BY`**, and
`formatTitleRefs` preserves input order, so `allRemovedIds` is roughly oldest-first with this
round's removals appended last. Then the prompt builder truncates from the wrong end:

```ts
function clampTitleList(titles: string[]): string[] {
  return titles.slice(0, MAX_TITLE_LIST_ENTRIES);   // MAX_TITLE_LIST_ENTRIES = 50
}
…
const removedTitles = clampTitleList(input.removedTitles);
```

`slice(0, 50)` keeps the **oldest** 50 exclusions and discards everything after — i.e. the
titles the couple rejected most recently, including the ones rejected on *this* round, are the
first to be dropped from the "Do NOT recommend any of these movies" list. A 10-round session at
5-7 recommendations per round comfortably exceeds 50 accumulated removals, and the round cap is
exactly 10.

The client truncates the opposite end for the same list —
`[...new Set([...carriedRemoved, ...removedThisRound])].slice(-MAX_ID_LIST_ENTRIES)`
(`src/app/results/[sessionId]/page.tsx:222-224`) keeps the newest 50 — so the two layers
disagree about which half matters.

Compounding this, the exclusion is enforced **nowhere in code**. `selectCandidates`
(`src/lib/matching.ts:80-150`) filters on dealbreaker genres and (in discovery mode) known
titles, but never on rejected ids, and `parseMatchingResponse` validates recommendations only
against `validTmdbIds`, which still contains every rejected title. A rejected movie that falls
out of the prompt list has nothing standing between it and the results page.

**Impact:** Deep into a refinement session — precisely when the couple has invested the most
effort saying "not that one" — the movies they just rejected come back. The feature reads as
broken at the exact moment its value is highest, and there is no code-level backstop to catch it.

---

### `MONTHLY_MATCH_LIMIT="0"` silently becomes 2000

**Location:** `src/app/api/movie-sessions/[id]/match/route.ts:105`
**Severity:** minor

**Evidence:**

```ts
const monthlyLimit = Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || DEFAULT_MONTHLY_MATCH_LIMIT;
```

`Number.parseInt("0", 10)` is `0`, which is falsy, so the `||` falls through to
`DEFAULT_MONTHLY_MATCH_LIMIT = 2000`. The design doc (§AI Security) calls for "a hard cap
(e.g. `$100/month`) that disables the matching endpoint rather than running up an unbounded
bill" — and `0` is the one value that expresses "disabled". Setting it does the opposite of
what an operator reaching for the kill switch intends. (`"-1"` happens to work, because `-1` is
truthy and `count >= -1` is always true, which makes the surprising case even harder to spot.)

**Impact:** The documented cost kill-switch can't be armed. An operator setting
`MONTHLY_MATCH_LIMIT=0` during a spend incident would believe matching is off while it keeps
serving up to 2000 Anthropic calls that month.

---

### Permanently-failing titles starve the weekly refresh queue forever

**Location:** `src/lib/cron-handler.ts:25-32, 55-81`
**Severity:** minor

**Evidence:** Selection is

```sql
SELECT tmdb_id, content_type FROM titles
WHERE last_refreshed_at IS NULL OR last_refreshed_at < strftime(…,'now','-7 days')
ORDER BY popularity DESC
LIMIT 200
```

and `last_refreshed_at` is written **only** inside the success path — the `UPDATE` is queued
after `fetchMovieDetail` resolves. A title whose TMDB detail fetch always fails (deleted from
TMDB, permanently 404ing, region-restricted) is caught by `catch { errors++; }` and keeps
`last_refreshed_at IS NULL`. Because the ordering is `popularity DESC`, that row sorts near the
front of the queue and is re-selected on **every** subsequent weekly run, indefinitely.

Separately, `flush()` does `refreshed += batch.length` after `db.batch(batch)` succeeds — it
counts *statements queued*, not rows actually updated, so the `cron_refresh` log line overstates
work whenever a queued `UPDATE` matches nothing.

**Impact:** N permanently-failing popular titles permanently consume N of the 200 weekly slots.
The tail of the catalog stops being refreshed and its `streaming` data goes stale without
anything in the logs distinguishing "200 refreshed" from "150 refreshed, 50 of them the same 50
failures as last week".

---

### Account deletion leaves orphaned groups behind the "this deletes your groups" promise

**Location:** `src/lib/account.ts:4-17`; copy at `src/app/profile/page.tsx:233-237`
**Severity:** minor

**Evidence:** `deleteAccount` anonymizes `session_members` and `movie_sessions`, then
`DELETE FROM users WHERE id = ?`. `group_members` cascades away (schema line 44), but the
`groups` rows themselves are never touched. For a solo user that leaves an empty `__solo__`
group; for someone who created a group nobody else joined, it leaves a zero-member group whose
`invite_code` still resolves in `joinGroup` (`src/lib/groups.ts:109-123`), so anyone still
holding the share link can join an ownerless group. The associated `movie_sessions` rows also
survive pointing at a `group_id` no live user belongs to.

The confirmation copy the user reads before typing "delete" is: *"This deletes your profile,
your groups and your sign-in."*

**Impact:** Not data loss, but the deletion doesn't do what it tells the user it does, and it
leaves reachable-by-invite-code shells behind. Given the design doc's privacy framing
("Account deletion removes all personal data"), this is a promise the code doesn't keep.

---

### The taste-map weighting note claims "at your request" for a flag someone else set

**Location:** `src/components/taste-map.tsx:192-201`; set via `src/app/ritual/page.tsx:273-280`
and stored by `src/lib/movie-sessions.ts:102-108`
**Severity:** minor

**Evidence:** In the full ritual, the person holding the device walks through a step per member
and sets the *other* members' rough-day flags:

```tsx
<RoughDayStep
  member={currentMember}
  …
  onChange={(on) => setMemberFlags({ ...memberFlags, [currentMember.userId]: on })}
/>
```

`createMovieSession` writes those into `session_members.rough_day` as that member's own flag
(`flags[memberId]?.roughDay ?? …`). Later, when that member opens the results on their own
device, `getSessionForMember` returns `roughDay` = their stored flag, and the results page
renders the note whenever it's set:

```tsx
showWeightingNote={session.roughDay && response.tasteMap.members.length > 1}
```

→ *"At your request, tonight's picks lean toward everyone else. Only you can see this."*

**Impact:** A member is told they asked for their own preferences to be deprioritized when they
did not — the flag was set for them on someone else's screen. The rough-day mechanic's whole
point is that it is a private, voluntary act of generosity; attributing it to the wrong person
inverts the framing.

---

## Design Concerns

**Every refinement guarantee is prompt-only, with no code backstop.** "Keep these",
"never recommend these again", and discovery mode's "do not recommend anything from their lists"
are all instructions in the system prompt (`src/lib/matching.ts:229-246`). Only discovery mode
has a matching code-level filter (`selectCandidates` drops `referencedIds`). Kept and removed
titles have none — `validTmdbIds` in `parseMatchingResponse` is the full candidate set. The
codebase already demonstrates the pattern (candidate filtering) and applies it inconsistently;
a single `candidates.filter(c => !removedIds.has(c.tmdbId))` would make the "never return"
contract structural instead of aspirational, and would also make the truncation bug above
harmless.

**`getAccumulatedRemovedIds` depends on unspecified row order.** No `ORDER BY` on
`SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ?` — the truncation bug's
"oldest survive" behavior happens to follow from rowid order, but nothing guarantees it, so the
same code could truncate arbitrarily on a different query plan.

**`resolveIds` binds exactly D1's 100-parameter ceiling.**
`src/app/api/titles/search/route.ts:53-61` is the only remaining unchunked `IN (...)` in the
codebase — `selectCandidates` and `getTitlesMap` both use `chunk()`/`D1_IN_CHUNK_SIZE`.
`MAX_RESOLVED_IDS = 100` and a full profile (50 comfort + 50 watchlist, distinct) makes
`fetchProfileDraft` request exactly 100 in one call, so it runs at the ceiling in normal use.
PLAT-1's own rule is "if you can't prove the collection is bounded *under* 100, chunk it", and
the fake D1 only throws above 100 — so a test cannot distinguish "safely at the limit" from
"one id over". Chunking it removes the cliff.

**`solo` and the prompt's member list can disagree after an account deletion.**
`getSessionForMember` computes `solo: row.member_count < 2` from the `session_members` count,
which still includes rows anonymized to `deleted-…`. `getSessionMembersWithProfiles` inner-joins
`users` and therefore returns only surviving members. A two-person session where one account was
deleted yields `solo: false` with a single member — the prompt then runs in group mode
("find where their tastes overlap", "one entry per member") against one profile.

**Client-side inputs have no cap matching the server's validation.** `TagPicker` enforces a
30-character tag length but no list length; `TitleSearch` enforces neither. The profile `PUT`
rejects >30 tags, >50 titles, and >10 unknown TMDB ids with a 400 whose body names the limit but
not which entries to remove. A user who over-fills their profile hits a save failure with no
in-UI path to fix it, and in the ritual that blocks "Continue" entirely
(`src/app/ritual/page.tsx:128-140`).

**No wall-clock guard around the Anthropic call inside a request handler.** `runMatching` can
make up to 2 app-level attempts, each of which the SDK may itself retry once
(`new Anthropic({ apiKey, maxRetries: 1 })`), for up to 4 Sonnet 5 calls with adaptive thinking
and a ~200-candidate prompt — all inside one Worker HTTP request with no deadline. The design
doc budgets 5-15 seconds and the client's `PhasedLoading` narrative is built for that; nothing
in the code bounds the worst case.

**The join-code regex is broader than the generating alphabet.**
`/^[2-9A-Za-z]{8}$/` (`src/app/api/groups/join/route.ts:9`) admits `I L O i l o`, which
`generateInviteCode` deliberately excludes. The direction is safe (permissive), but the route's
comment asserts "a malformed code can never match a real invite code (see src/lib/groups.ts's
alphabet note)" — the regex doesn't actually encode that alphabet, so structurally-impossible
codes still consume a rate-limit slot and a DB lookup.
