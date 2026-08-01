# Bug Hunt — Phase 1, Consolidated Findings

**Date:** 2026-08-01
**Base:** `origin/dev` @ 382394e (worktree `bug-hunt-2026-08-01`, branch `claude/bug-hunt-2026-08-01`)
**Inputs:** `dev/bug-hunts/2026-08-01-phase1-exploratory.md`, `-holistic.md`, `-multipass.md`
**Method:** every finding from all three reports was deduplicated, then re-verified against the
actual source at the cited location. Line numbers below are the consolidator's own reads, not the
hunters'. Where a hunter's line reference was off by a line or two it is silently corrected;
where a hunter's *claim* was wrong it is called out.

**Executive summary:** 15 confirmed bugs · 7 design decisions requiring user input ·
3 false positives · 1 out of scope.

Deliberately-accepted races (group-join rate limit, match round limit) were excluded from all
three hunts by instruction and are not re-reported. The multipass report's "duplicate `__solo__`
groups" race is **not** one of them — see B15.

---

## Confirmed Bugs

### B1. Concurrent authenticated requests lose the refresh-token rotation race and get a 401 each

**Consensus:** 3/3 — exploratory #1, holistic #1, multipass #5. No disagreement; the three
differ only in which client fan-out they traced (two-tab `/api/auth/me` vs. `/ritual`'s
three-way `Promise.all` vs. `/profile`'s two-way).
**Severity:** significant
**Location:** `src/lib/auth.ts:115-125`; triggers at `src/app/ritual/page.tsx:75-79`,
`src/app/profile/page.tsx:97`, `src/components/auth-provider.tsx:32-49`

**Evidence.** The rotation claims the session with a single-winner delete:

```ts
// src/lib/auth.ts:115-125
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

The comment resolves the cookie half of the race and stops there. The loser returns
`user: null`, which all 11 route files map to a flat 401.

Reachability verified end to end:

- `setAuthCookies` pins the session cookie to `Max-Age=900` (`src/lib/auth.ts:188`), tied to the
  15-minute JWT, so after 15 idle minutes the browser sends **only** `mn-refresh` and every
  request must take the rotation path.
- `AuthProvider`'s effect has an empty dependency array (`src/components/auth-provider.tsx:49`)
  and lives in the root layout (`src/app/layout.tsx:37`), so a client-side `next/link`
  navigation reuses the cached `user` and never re-authenticates first.
- `/ritual` then fires three authenticated requests simultaneously:
  `Promise.all([fetchProfileDraft(), fetchQuickPicks(), fetchGroup(groupId)])`
  (`src/app/ritual/page.tsx:75-79`). `/profile` fires two (`src/app/profile/page.tsx:97`).

**Impact.** Deterministic, not intermittent: any client-side navigation into `/ritual` or
`/profile` more than 15 minutes after the previous request loses N−1 of N requests.
`fetchProfileDraft() === null` sets *"We couldn't load your profile. Reload to try again."*
(`ritual/page.tsx:84`), `fetchGroup() === null` sets the group equivalent (line 88) — either
replaces the entire ritual with a dead-end error screen. On `/profile` the same failure renders
at `src/app/profile/page.tsx:159`. The two-tab variant is worse: the losing tab's `AuthProvider`
sets `user: null` and every gated page does `router.replace("/")`
(`src/app/tonight/page.tsx:25`, `src/app/groups/page.tsx:85`, results, ritual, quick) — the user
is bounced to the landing page with a perfectly valid session. Reload always fixes it, which is
exactly why it will be misdiagnosed as a network blip. Nothing in the app retries a 401.

**Blast radius.** `authenticateRequest` is called by all 11 API route files (13 call sites). Any
fix changes the shared auth contract. Options that stay inside `src/lib/auth.ts` — a short grace
window on the just-rotated token, or a retry/wait on the loser — do not leak outside `src/`, but
they do change what callers can assume: today a `user: null` means "unauthenticated", and every
route depends on that being the only meaning. `src/lib/auth.test.ts:375` asserts the current
loser behavior explicitly (including "must NOT clear cookies"), so that test must be revisited,
not just extended.

**Fix approach.** Keep the atomic claim; make the loser recoverable. Either (a) retain the
previous token hash for a short grace window (a `replaced_by`/`rotated_at` column, or a brief
second row) so a loser can still authenticate, or (b) have the loser re-read the session table
after a short backoff and, failing that, return a third state (`stale_rotation`) that routes map
to a retryable response rather than 401. (a) is the standard refresh-token-reuse-detection shape
and is the smaller behavioral change for callers.

---

### B2. Leaving a group does not revoke matching authority over that group's sessions

**Consensus:** 2/3 — exploratory #2, multipass #1. Holistic did not examine the leave→match path.
**Severity:** significant (privacy)
**Location:** `src/lib/groups.ts:173-178`, `src/lib/movie-sessions.ts:164-176`,
`src/app/api/movie-sessions/[id]/match/route.ts:87-90`

**Evidence.** `leaveGroup` deletes exactly one row:

```ts
// src/lib/groups.ts:174-177
await db
  .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
```

but every session authorization decision is keyed on `session_members`, which is deliberately
preserved:

```sql
-- src/lib/movie-sessions.ts:174-176
FROM movie_sessions ms
JOIN session_members sm ON sm.session_id = ms.id AND sm.user_id = ?
WHERE ms.id = ?
```

`POST /api/movie-sessions/[id]/match` gates on that check and **nothing else** (route lines
87-90), then calls `getSessionMembersWithProfiles` (`src/lib/movie-sessions.ts:225-260`), which
reads the **current** `profiles` rows — `LEFT JOIN profiles p ON p.user_id = sm.user_id` at line
235 — and feeds every surviving member's present-day comfort films, watchlist, vibes and
dealbreakers to the model.

**Design-doc check.** `dev/plans/design-doc.md:275` intends `session_members` to persist so
*history* survives. `design-doc.md` §privacy states taste profiles are not visible outside the
user's group. Preserving read access to a stored round is intended; **re-deriving a new analysis
from live profile data after leaving is not.** The group surface is correctly closed —
`getGroupDetailForMember` checks `group_members` (`src/lib/groups.ts:137-141`) and 404s an
ex-member — so this is an inconsistency inside the codebase, not a uniform policy.

**Impact.** After a couple splits and one person leaves, that person can open any old session URL
and press Regenerate, up to the 10-round budget, on the account owner's Anthropic spend, and get
a freshly generated taste map, per-pick explanations and conversational write-up derived from the
other person's *post-split* profile. The join page promises the opposite:
*"Joining … shares your taste profile with its other members. You can leave any time."*
(`src/app/groups/join/[code]/page.tsx:94`).

**Blast radius.** `getSessionForMember` has exactly two callers: the read-only session GET
(`src/app/api/movie-sessions/[id]/route.ts:28`) and the match POST (`match/route.ts:87`). A fix
must **not** be pushed into `getSessionForMember` itself — that would also close the history
read, which the design doc explicitly wants preserved. Gate the match POST only. Contained to
`src/app/api/movie-sessions/[id]/match/route.ts` plus one new membership helper in
`src/lib/groups.ts`; nothing outside `src/` moves. `src/lib/groups.test.ts:206` asserts the
preservation invariant and will keep passing.

**Fix approach.** In the match POST, after `getSessionForMember` succeeds, additionally require a
live `group_members` row for `(session.groupId, user.userId)`; 403 otherwise. Solo sessions are
unaffected (the creator is always in their own `__solo__` group).

---

### B3. The accumulated "never recommend again" list is truncated to the 50 **oldest** exclusions

**Consensus:** 3/3 — exploratory #5 (rated minor), holistic #2 (significant), multipass #2
(significant). The severity disagreement is the only divergence; I side with holistic/multipass —
this silently breaks the refinement loop's headline guarantee for exactly the users who engage
most.
**Severity:** significant
**Location:** `src/lib/matching.ts:185-187` and `234`; producer at
`src/app/api/movie-sessions/[id]/match/route.ts:117-119, 146`; opposite-direction cap at
`src/app/results/[sessionId]/page.tsx:221-223`

**Evidence.** The route builds the union oldest-first, this round's removals appended last:

```ts
// src/app/api/movie-sessions/[id]/match/route.ts:117-119
const allRemovedIds = [
  ...new Set([...(await getAccumulatedRemovedIds(db, id)), ...removedTmdbIds]),
];
```

and the prompt builder slices from the **front**:

```ts
// src/lib/matching.ts:185-187
function clampTitleList(titles: string[]): string[] {
  return titles.slice(0, MAX_TITLE_LIST_ENTRIES);   // MAX_TITLE_LIST_ENTRIES = 50
}
```

applied to `removedTitles` at line 234. `formatTitleRefs` preserves input order
(`src/lib/movie-sessions.ts:313-315`), so the entries dropped are the newest — including the ones
removed on *this* request.

The client caps the same list from the other end:
`[...new Set([...carriedRemoved, ...removedThisRound])].slice(-MAX_ID_LIST_ENTRIES)`
(`results/[sessionId]/page.tsx:221-223`) keeps the newest 50. The two layers disagree about which
end is expendable.

**No code-level backstop.** `selectCandidates` (`src/lib/matching.ts:80-150`) filters on
dealbreaker genres and, in discovery mode, on member-referenced titles — never on removed ids.
`parseMatchingResponse` validates against `validTmdbIds`, which is the full candidate set
(`matching.ts:482`). The prompt line is the only mechanism standing between a rejected film and
the results page.

**Reachability.** Each round returns 5-7 recommendations (`matching.ts:267`), the route accepts up
to 50 removed ids per request, and the round cap is 10. A couple rejecting most picks crosses 50
accumulated exclusions around round 8 — inside the budget.

**Design-doc check.** `dev/plans/design-doc.md:308` — *"Removed movies are permanently excluded
(accumulated across rounds, never return)."* This is a contract violation, not a judgement call.

**Folded in — holistic design concern HDC2 (`getAccumulatedRemovedIds` has no `ORDER BY`).**
Verified: `src/lib/movie-sessions.ts:126-129` selects with no ordering clause. The "oldest
survive" behavior today follows from rowid order, but nothing guarantees it; a different query
plan would truncate arbitrarily. Any fix here must make the order explicit, not merely flip the
slice direction.

**Blast radius.** `clampTitleList` is shared by four call sites (`matching.ts:233, 234, 277,
278`). The member comfort/watchlist uses at 277-278 are already capped at 50 server-side
(`src/app/api/user/profile/route.ts:11,35`), so changing the slice direction globally would be a
no-op for them — but it is still safer to fix at the producer. Confined to `src/lib/matching.ts`
+ `src/lib/movie-sessions.ts`; nothing outside `src/`. `src/lib/matching.test.ts:489` currently
asserts the wrong direction and must be updated (see Test Gap Analysis).

**Fix approach.** Two independent changes, both worth making: (1) add `ORDER BY round_number DESC`
(or reverse the union) so the newest exclusions are first, and keep `slice(0, 50)`; (2) add the
structural backstop — `candidates.filter(c => !removedIds.has(c.tmdbId))` in `selectCandidates` —
which makes the "never return" contract hold regardless of prompt truncation. (2) is the real
fix; (1) alone leaves the guarantee prompt-only (see D1).

---

### B4. A transient D1 write failure mid-rotation permanently destroys the 90-day session and escapes every route's error handling

**Consensus:** 1/3 — multipass #4 only. Same code location as B1; a different failure mode
(crash, not race), and the two need different fixes.
**Severity:** significant
**Location:** `src/lib/auth.ts:115-118` (claim) and `135-159` (re-issue)

**Evidence.** Rotation is destroy-then-recreate with no compensating action. Between the
`DELETE … RETURNING` (line 115) and the replacement `INSERT` (line 154-159) there is an
intervening `SELECT email FROM users` (line 135-138). Any throw in that window — D1 overload,
"requests queued for too long", any storage-layer 5xx — leaves the old session row deleted and
no new one written.

The exception propagates out of `authenticateRequest`, which every route calls **before** its
`try` block. Verified: `src/app/api/movie-sessions/[id]/match/route.ts:61` vs. `try` at line 86;
`src/app/api/user/profile/route.ts:62` and `:93` vs. `try` at 67 / 115. Nothing catches it, and
no `Set-Cookie` clears the now-dead cookies.

**Impact.** One transient blip signs the user out permanently. Their refresh token no longer
exists in `sessions`, the browser keeps sending it, and every subsequent request falls into the
`!claimed` branch (`auth.ts:120-125`) which deliberately does not clear cookies — so the user is
stuck at 401 forever until they manually clear cookies. They also see a raw framework 500 rather
than the route's JSON error, because the throw happens outside the handler's `try`.

**Blast radius.** Same 13 call sites as B1. A fix that wraps `authenticateRequest`'s rotation in
its own try/catch and clears cookies on failure changes the contract in a *safe* direction (the
user is signed out cleanly instead of permanently wedged), and stays inside `src/lib/auth.ts`.
Note the interaction with B1: any grace-window fix for B1 also softens B4, because the old token
would still be usable.

**Fix approach.** Wrap the rotation (claim → lookup → insert) so a post-claim throw is caught,
clears auth cookies, and returns `{ user: null, headers }` rather than propagating. Better still:
issue the replacement row in the same `db.batch` as the delete so the pair is atomic.

---

### B5. Account deletion leaves the deleted user's real name in every persisted round, contradicting the app's explicit "[deleted user]" promise

**Consensus:** 2/3 — exploratory #3 (bug), multipass design concern MDC5. Holistic flagged a
different, adjacent deletion gap (see B14).
**Severity:** significant (false statement in a privacy disclosure)
**Location:** `src/lib/account.ts:4-17`; `src/app/api/movie-sessions/[id]/route.ts:38`;
promise text at `src/app/profile/page.tsx:235` and `src/app/privacy/page.tsx:90`

**Evidence.** `deleteAccount` anonymizes the join key and hard-deletes the user row:

```ts
// src/lib/account.ts:8-16
await db.batch([
  db.prepare("UPDATE session_members SET user_id = 'deleted-' || lower(hex(randomblob(4))) WHERE user_id = ?").bind(userId),
  db.prepare("UPDATE movie_sessions SET initiated_by_user_id = 'deleted' WHERE initiated_by_user_id = ?").bind(userId),
  db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
]);
```

It never touches `recommendations.ai_response`, which stores the full `MatchingResponse` JSON
(`migrations/0001_initial_schema.sql`, `ai_response TEXT NOT NULL, -- full MatchingResponse JSON`;
written at `src/lib/movie-sessions.ts:340`). That JSON carries the member's real name in
`tasteMap.members[].name` — required by the schema (`src/types/matching.ts:52`), fed from the
member list (`src/lib/matching.ts:276`) — and in `conversational`, which the prompt instructs to
*"Reference members by name"* (`matching.ts:259`).

`GET /api/movie-sessions/[id]` re-serves that blob verbatim to any remaining member
(`route.ts:38`), and `src/components/taste-map.tsx:63` renders `{member.name}` directly.

Grep confirms the strings `[deleted user]` and `Former member` appear nowhere in `src/**` except
the two pages that promise them.

**Design/plan check.** `dev/plans/design-doc.md:62` — *"the deleted user's identity is replaced
with '[deleted user]'"*. `dev/research/plan-review-round4.md:41` flagged this exact surface
(*"7.5 taste map uses AI-response names"*) and recommended a "Former member" placeholder. Nothing
was implemented. The round-4 note assumed exposure was "limited to the 5.4 session GET" — verified
false: the session GET returns no member names of its own, so the AI-response blob is the *only*
exposure surface, and it is unhandled.

**Impact.** The user is told, at the moment of an irreversible action, that their name is replaced.
It is not. Every past taste map and write-up their ex-partner can still open keeps naming them.

**Blast radius.** `deleteAccount` has one caller (`src/app/api/user/account/route.ts:20`).
`<TasteMap>` has one render site (`src/app/results/[sessionId]/page.tsx:346`). Both fix shapes are
contained to `src/`. A scrub-at-delete fix touches stored data irreversibly and must handle the
`conversational` free text (where the name is embedded in prose, not a field) — that is the hard
part. A render-time fix requires the session GET to tell the client which `userId`s are gone,
which is a small API-contract addition consumed by exactly one component, but does not help the
`conversational` tab either.

**Fix approach.** Needs a decision on scope (structured fields only, or free text too) — but the
minimum honest fix is either to implement the placeholder for `tasteMap.members[].name` **and**
soften the privacy copy to match what is actually scrubbed, or to scrub at delete time. Do not
ship the current copy unchanged.

---

### B6. The weekly refresh queue starves the catalog's long tail

**Consensus:** 2/3 — multipass #3 (ordering starves ranks 201+), holistic #4 (permanently-failing
titles hold slots forever). Two distinct mechanisms on the same query; the fix family is shared.
**Severity:** significant
**Location:** `src/lib/cron-handler.ts:10, 25-32, 43-53, 78-80`; catalog size at
`scripts/seed.ts:19` (`DEFAULT_PAGES = 50`); schedule `"crons": ["0 9 * * 1"]`
(`wrangler.jsonc:13`)

**Evidence.**

```sql
-- src/lib/cron-handler.ts:27-30
SELECT tmdb_id, content_type FROM titles
WHERE last_refreshed_at IS NULL OR last_refreshed_at < strftime(…,'now','-7 days')
ORDER BY popularity DESC
LIMIT 200
```

`last_refreshed_at` is written **only** on the success path (the `UPDATE` at lines 60-73 is queued
after `fetchMovieDetail` resolves); the per-title `catch { errors++; }` at 78-80 writes nothing.
The seed sets `last_refreshed_at = now` for every row (`scripts/seed-lib.ts:57`, value `now` in
`titleToInsertStatement`), and the default seed is 50 discover pages ≈ 1000 titles.

**Mechanism A (holistic — unconditional).** A title whose TMDB detail fetch always fails (deleted
upstream, permanently 404ing, region-restricted) keeps `last_refreshed_at IS NULL` forever, so it
always satisfies the staleness predicate, and `ORDER BY popularity DESC` re-selects it on every
run. N such popular titles permanently consume N of the 200 weekly slots. This one holds
regardless of timing.

**Mechanism B (multipass — conditional, and I am flagging the condition the hunter did not).**
Whether the previous run's top-200 re-qualify next week depends on cron jitter: the stored
`last_refreshed_at` is captured a few milliseconds *after* the run's SELECT, so if two consecutive
triggers were exactly 7 days apart the top-200 would be excluded and the sweep would advance. In
practice Cloudflare cron triggers are best-effort and routinely fire later than the nominal time,
so any week whose trigger is later than the previous week's + processing delta re-qualifies the
top 200 and starves ranks 201+. The failure mode is real and likely, but it is not the
deterministic "never, forever" the multipass report states. **Corrected.**

**Also confirmed (holistic, sub-finding):** `flush()` does `refreshed += batch.length` after
`db.batch(batch)` succeeds (`cron-handler.ts:48-49`) — it counts statements queued, not rows
updated — and `errors += batch.length` in the `catch` (line 50-52) aggregates into the same
counter as the per-title `errors++` at line 79. See D6.

**Impact.** For a large fraction of the catalog, `streaming`, `popularity`, `vote_count` and
`vote_average` stay frozen at seed time. Users see it: `asOfNote`
(`src/components/ranked-list.tsx:35-42`) starts printing "as of <seed date>" on those picks after
a fortnight and never stops. `popularity` is also the sole ordering key for `selectCandidates`'
pool, so the candidate set itself calcifies. Design doc success criterion — *"where to watch info
that's actually correct"* — degrades permanently.

**Blast radius.** `runWeeklyRefresh` has one caller (`worker.ts:16`). Entirely contained to
`src/lib/cron-handler.ts`. No API or UI contract changes. Behavior callers depend on: none beyond
the `cron_refresh` log line's shape.

**Fix approach.** Order by `last_refreshed_at ASC` (oldest first) so the cursor sweeps the whole
catalog, or split the budget between "most popular" and "least recently refreshed". Independently,
record an attempt timestamp (or a failure counter) on the error path so a permanently-failing
title cannot hold a slot forever.

---

### B7. `MONTHLY_MATCH_LIMIT=0` silently becomes 2000 — the spend kill switch cannot be armed

**Consensus:** 2/3 — holistic #3, multipass #10. Exploratory did not examine the config path.
**Severity:** minor by blast radius, high by operational consequence
**Location:** `src/app/api/movie-sessions/[id]/match/route.ts:105`

**Evidence.**

```ts
const monthlyLimit = Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || DEFAULT_MONTHLY_MATCH_LIMIT;
```

`Number.parseInt("0", 10)` is `0`, which is falsy, so `||` substitutes
`DEFAULT_MONTHLY_MATCH_LIMIT = 2000` (line 25). Verified: `"-1"` happens to work, because `-1` is
truthy and `count >= -1` is always true — which makes the broken case harder to notice.

**Design-doc check.** `dev/plans/design-doc.md:77` calls for *"a hard cap (e.g. $100/month) that
disables the matching endpoint rather than running up an unbounded bill."* `0` is the one value
that expresses "disabled", and it does the opposite.

**Impact.** An operator setting `MONTHLY_MATCH_LIMIT=0` during a spend incident believes matching
is off while it keeps serving up to 2000 Anthropic calls that month.

**Blast radius.** One line, one route, one env var. No callers depend on the current behavior.
Zero risk.

**Fix approach.** `const parsed = Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10);` then
`const monthlyLimit = Number.isNaN(parsed) ? DEFAULT_MONTHLY_MATCH_LIMIT : parsed;`. Consider
also rejecting negatives.

---

### B8. The taste map's weighting note claims weighting was applied when the engine explicitly cancelled it

**Consensus:** 1/3 — multipass #7. (Holistic flagged a *different* claim about the same line —
see FP1.)
**Severity:** minor
**Location:** `src/app/results/[sessionId]/page.tsx:350` vs. `src/lib/matching.ts:204-208`;
rendered at `src/components/taste-map.tsx:192-201`

**Evidence.** The engine cancels the weighting when everyone toggled:

```ts
// src/lib/matching.ts:205-208
const toggledCount = members.filter((m) => m.roughDay).length;
if (toggledCount === 0 || toggledCount === members.length) {
  return "No preference weighting — treat all profiles equally.";
}
```

The UI derives the note purely from the viewer's own flag plus the member count:

```tsx
// src/app/results/[sessionId]/page.tsx:350
showWeightingNote={session.roughDay && response.tasteMap.members.length > 1}
```

and renders *"At your request, tonight's picks lean toward everyone else. Only you can see this."*
(`taste-map.tsx:198-199`).

**Impact.** When both people in a couple toggle rough-day — which the design explicitly
anticipates ("if both toggle it, weights cancel") — each is told their generosity was applied,
while the prompt instructed the model to treat all profiles equally. The note is a factual claim
about engine behavior, and in that case it is false.

**Blast radius.** `SessionView` (`src/lib/movie-sessions.ts:147-158`) deliberately serializes only
the requester's own flag; the comment at line 156 is explicit. A fix needs the session view to
carry the group's *toggle count* (or a boolean "weighting was applied") — a scalar, which leaks
nothing about who toggled. That is an additive API-contract change consumed by exactly one
component (`<TasteMap>` has one render site). Touches `src/lib/movie-sessions.ts`,
`src/app/api/movie-sessions/[id]/route.ts` and the results page. Nothing outside `src/`.

**Fix approach.** Add `weightingApplied: boolean` to `SessionView`, computed with the same
`toggledCount === 0 || toggledCount === members.length` rule against `session_members`, and gate
the note on it.

---

### B9. `getSessionForMember.member_count` counts anonymized deleted members, so `solo` disagrees with the actual prompt membership

**Consensus:** 2/3 — exploratory #6, holistic design concern HDC4. Multipass did not connect the
two queries.
**Severity:** minor
**Location:** `src/lib/movie-sessions.ts:173` and `202`, vs. `225-236`

**Evidence.** Solo-ness comes from a raw row count:

```sql
-- src/lib/movie-sessions.ts:173
(SELECT COUNT(*) FROM session_members WHERE session_id = ms.id) as member_count
```
```ts
// src/lib/movie-sessions.ts:202
solo: row.member_count < 2,
```

but the members actually sent to the model come from a query that **inner-joins `users`** and
therefore drops deleted accounts (`getSessionMembersWithProfiles`, `JOIN users u ON u.id =
sm.user_id` at line 234; the doc comment at 222-224 states this is deliberate). `deleteAccount`
rewrites `session_members.user_id` to a `deleted-xxxxxxxx` sentinel rather than deleting the row
(`src/lib/account.ts:9-11`), so the count still sees it.

**Impact.** After one member of a two-person session deletes their account, the survivor's session
reports `solo: false` while exactly one member is sent to the model. The prompt then asks a
single-member "group" to *"find where their tastes overlap"* and to populate `tensionPoints` with
*"the key taste conflicts"* (`matching.ts:224, 255`) — the solo-specific prompt variant, which
exists precisely for this shape, is skipped. The rendered page is internally inconsistent too:
`TasteMap` computes its own `solo = members.length < 2` (`taste-map.tsx:90`) and shows solo copy.

**Blast radius.** `getSessionForMember` has two callers (session GET, match POST). Changing the
subquery to join `users` affects both, but in the correct direction for both. Contained to
`src/lib/movie-sessions.ts`. `src/lib/movie-sessions.test.ts:365-398` covers three solo/non-solo
cases and would keep passing.

**Fix approach.** Make the count agree with the member query — `(SELECT COUNT(*) FROM
session_members sm2 JOIN users u2 ON u2.id = sm2.user_id WHERE sm2.session_id = ms.id)`.

---

### B10. The tag and title pickers enforce no count limit, so a reachable selection makes every save 400

**Consensus:** 3/3 — exploratory #7, holistic design concern HDC5, multipass design concern MDC8.
Exploratory rated it a bug; the other two filed it as a design concern. It is a bug: the failure
state is reachable through normal UI use with no in-app way out.
**Severity:** minor
**Location:** `src/components/tag-picker.tsx:29-47, 85`, `src/components/title-search.tsx:79-85`
vs. `src/app/api/user/profile/route.ts:11-14, 35, 42` and
`src/app/api/movie-sessions/[id]/match/route.ts:26`

**Evidence.** `TagPicker.toggle` (lines 29-35) and `addCustomTag` (37-47) cap tag *length* only
(`maxLength={MAX_TAG_LENGTH}`, line 85) — never the tag *count*. The preset vocabulary is exactly
30: 16 `MOOD_TAGS` + 14 `GENRE_TAGS` (`src/config/tags.ts:3-13`, counted). The server cap is also
30 (`MAX_TAG_LIST_ENTRIES = 30`, profile route line 12). Selecting every preset chip and then
adding one custom tag yields 31 and a hard `400 "vibes can hold at most 30 entries"`.
`TitleSearch.add` (lines 79-85) has no cap either, against `MAX_TITLE_LIST_ENTRIES = 50`.

**Impact.** The failure surfaces late and far from the cause. In the ritual it blocks "Continue →"
at step 0 (`src/app/ritual/page.tsx:128-140` — the save must succeed before `setStep`), and for
`moodVibes` it surfaces as the full-page *"Not tonight, apparently"* error screen. The 400 body
names the limit but not which entries to remove, and nothing in the UI indicates a limit exists.

**Blast radius.** `<TagPicker>` has 3 render sites (`profile-editor.tsx:99, 110`,
`mood-screen.tsx:54`); `<TitleSearch>` has 2 (`profile-editor.tsx:76, 88`). A `max` prop with a
default is additive and breaks nothing. Confined to `src/components/`. Note `mood-screen`'s
`TagPicker` feeds `moodVibes`, capped at 30 by `src/app/api/movie-sessions/route.ts`, and
`/quick` already implements the right pattern (`src/app/quick/page.tsx:94-106, 244-250`: refuse
the tap, say why) — copy it.

**Fix approach.** Add a `max` prop to both components; refuse the add and show the
`aria-live` "N is the limit — remove one first" message, matching `/quick`.

---

### B11. "Back to the mood" after a failed match creates a duplicate session on every retry

**Consensus:** 1/3 — exploratory #8.
**Severity:** minor
**Location:** `src/app/ritual/page.tsx:151-173, 215-224, 327`; identical shape at
`src/app/quick/page.tsx:117-139, 181-190, 266`

**Evidence.** `submit()` unconditionally calls `startSession(...)` (`ritual/page.tsx:155`) — it
never checks the `sessionId` state it set at line 169. The "Try again" button correctly branches
(`if (sessionId !== null) runMatch(sessionId) else submit()`, lines 205-209), but "Back to the
mood" clears only two flags:

```tsx
// src/app/ritual/page.tsx:217-220
onClick={() => {
  setMatching(false);
  setMatchError(null);
}}
```

leaving `sessionId` populated. The user lands back on the mood step whose only CTA is
`onClick={() => void submit()}` (line 327).

**Impact.** Each pass through the error screen via "Back to the mood" (or "Change the vibe" on
`/quick`, lines 181-190) writes another `movie_sessions` row plus one `session_members` row per
member, all orphaned — no recommendation ever attaches. It also silently resets the 10-round
budget, since `getRoundNumber` counts per-session (`src/lib/movie-sessions.ts:116-122`). Cheap per
occurrence, but it is the most likely path a user takes after a `thin_results` or `timeout`
failure.

**Blast radius.** Two page components; no shared code. `startSession` and `createMovieSession`
are unchanged. Nothing outside `src/app/`.

**Fix approach.** Have `submit()` reuse an existing `sessionId` (call `runMatch(sessionId)` when
non-null), or clear `sessionId` when returning to the mood step. The former is better — it keeps
the round budget honest.

---

### B12. A paid matching round is discarded when persistence or title hydration fails

**Consensus:** 2/3 — multipass #9, exploratory design concern EDC2 ("money is spent before the
round is recorded").
**Severity:** minor
**Location:** `src/app/api/movie-sessions/[id]/match/route.ts:154-165`

**Evidence.** After `runMatching` returns (the Anthropic call has completed and been billed):

```ts
await insertRecommendation(db, { … });                                             // 154-162
const titles = await getTitlesMap(db, response.recommendations.map((rec) => rec.tmdbId)); // 164
return withAuthHeaders(NextResponse.json({ round, response, titles }), headers);   // 165
```

Both awaits sit inside the outer `try` (opened at line 86) whose only non-`MatchingError` branch
is `500 "Match failed"` (lines 171-172).

- If `insertRecommendation` throws, the model's response is lost entirely and a retry pays for a
  whole new call. Because `getRoundNumber` counts `recommendations` rows, the round budget also
  never advances.
- If the *second* `getTitlesMap` throws, the round **was** persisted (budget consumed,
  `getAccumulatedRemovedIds` will include it) but the client is told the round failed.
  `runRound` (`src/app/results/[sessionId]/page.tsx:122-143`) then leaves `carriedRemoved`
  un-updated, so the client's exclusion state desyncs from the server's.

**Impact.** Money and state are lost on a D1 hiccup at the last step of the app's most expensive
path. The response is already in memory and could be returned with an empty/partial `titles` map —
`RankedList` already handles a missing title (`src/components/ranked-list.tsx:129-132`:
`const name = title?.title ?? \`pick ${index + 1}\``).

**Blast radius.** One route. The client already tolerates a sparse `titles` map, so returning
partial data is contract-compatible. `src/app/api/movie-sessions/[id]/match/route.test.ts:432`
("failed rounds are not persisted") asserts the *pre-call* failure case and is unaffected.

**Fix approach.** Wrap the trailing `getTitlesMap` in its own try/catch and fall back to `{}`.
For the `insertRecommendation` failure, at minimum log the response body so it is recoverable;
retrying the insert once is cheap and proportionate.

---

### B13. `parseMatchingResponse` never validates `tasteMap.overlap`, and the read path validates nothing at all

**Consensus:** 2/3 — exploratory #4 (rated significant), multipass #8 (minor). I side with
multipass on severity, and I am **downgrading the write-path half of exploratory's claim** — see
below.
**Severity:** minor
**Location:** `src/lib/matching.ts:347-357`; `src/app/api/movie-sessions/[id]/route.ts:38`;
consumed at `src/components/taste-map.tsx:89, 164, 166, 174` and `66, 70`

**Evidence.** The guard — explicitly labelled *"Structured outputs guarantee the schema, but parse
defensively anyway"* (line 345) — checks five things and stops one short:

```ts
// src/lib/matching.ts:347-357
if (
  shaped === null || typeof shaped !== "object" ||
  typeof shaped.conversational !== "string" ||
  !Array.isArray(shaped.recommendations) ||
  shaped.tasteMap === null || typeof shaped.tasteMap !== "object" ||
  !Array.isArray(shaped.tasteMap.members)
) { throw new MatchingError("malformed"); }
```

The only consumer destructures and dereferences with no guard: `const { members, overlap } =
tasteMap` (taste-map.tsx:89), then `{overlap.summary}` (164),
`overlap.sharedVibes.length` (166), `overlap.tensionPoints.length` (174); same for
`member.primaryVibes` / `member.genreAffinities` (66, 70).

**Correction to exploratory's probability claim.** `MATCHING_RESPONSE_SCHEMA`
(`src/types/matching.ts:56-68`) declares `overlap` with `required: ["summary", "sharedVibes",
"tensionPoints"]` and the parent `required: ["members", "overlap"]`, `additionalProperties:
false`. Structured outputs therefore *do* enforce it on the write path. The realistic path to a
missing `overlap` is a corrupted or hand-edited `ai_response` column, or a future
schema/SDK/`output_config` regression — not normal model behavior.

**The undefended half is the read path.** `GET /api/movie-sessions/[id]:38` is
`parseJsonColumn<MatchingResponse | null>(latest.ai_response, null)` — anything that parses as
JSON is handed to the renderer as a `MatchingResponse`, with no shape check whatsoever. (This is
exploratory design concern EDC5, folded in here — same root.) Verified there is no `error.tsx` or
`global-error.tsx` anywhere under `src/app/`, so a render throw hits Next's built-in boundary: a
blank/error page, reproduced on every reload of that session, with no route back to the refine
panel.

**Blast radius.** `parseMatchingResponse` is called only from `runMatching`
(`src/lib/matching.ts:496`). The read path's parse is in one route. Both fixes are additive
validation; the only behavior change is that a corrupt row now yields a clean error instead of a
crash. Nothing outside `src/`.

**Fix approach.** Extend the parse guard to `overlap` and the per-member array fields, and add
the same shape check on the read path (share one `isMatchingResponse` predicate between the two)
so a corrupt row degrades to `response: null` — which the results page already renders as
"Nothing picked yet" with a working "Find our match →" button (`results/[sessionId]/page.tsx:238`).

---

### B14. Account deletion leaves orphaned, still-joinable groups behind the "this deletes your groups" promise

**Consensus:** 2/3 — holistic #5, multipass design concern MDC6.
**Severity:** minor
**Location:** `src/lib/account.ts:4-17`; `src/lib/groups.ts:109-123`; copy at
`src/app/profile/page.tsx:233`

**Evidence.** `deleteAccount` never touches the `groups` table. `group_members` cascades away
(`migrations/0001_initial_schema.sql`: `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE
CASCADE`), but the `groups` row survives, and `movie_sessions.group_id REFERENCES groups(id) ON
DELETE CASCADE` means the sessions survive with it, pointing at a group no live user belongs to.

For a shared group whose creator deletes their account, the surviving `invite_code` still resolves:

```ts
// src/lib/groups.ts:110-113
.prepare("SELECT id, name, invite_code, created_at FROM groups WHERE invite_code = ? AND name != ?")
```

so anyone still holding the share link can join an ownerless group. Verified the `__solo__` case
is **harmless**: its invite code is `solo-<uuid>` (`src/lib/movie-sessions.ts:40`), which fails
the 8-char `CODE_FORMAT` at `src/app/api/groups/join/route.ts:9,34` *and* is excluded by name in
`joinGroup`. So the solo residue is litter, not a hole.

The confirmation copy the user reads before typing "delete" is *"This deletes your profile, your
groups and your sign-in."* (`src/app/profile/page.tsx:233`).

**Also verified (multipass sub-claim):** `leaveGroup` has no guard against a `__solo__` group id.
A user who discovers their solo group id could leave it and strand its session history; a fresh
solo group is silently created on their next solo session (`createSoloGroup`,
`src/lib/movie-sessions.ts:24-46`). Not reachable through the UI — `getGroupsForUser` excludes
`__solo__` (`src/lib/groups.ts:159`) so the id is never surfaced — but the API accepts it.

**Impact.** Not data loss, but the deletion doesn't do what it tells the user it does, and it
leaves reachable-by-invite-code shells behind.

**Blast radius.** `deleteAccount` has one caller. Adding a "delete groups that lost their last
member" statement to the existing `db.batch` is contained — but it is destructive of
`movie_sessions` rows via CASCADE, so it must only fire when the group is genuinely empty. A
`__solo__` guard in `leaveGroup` is a two-line change with one API caller
(`src/app/api/groups/[id]/leave/route.ts:23`).

**Fix approach.** Either (a) in the deletion batch, delete groups with no remaining members, or
(b) leave the data and correct the copy. (a) is what the copy promises. Separately, reject
`__solo__` group ids in `leaveGroup`.

---

### B15. `createSoloGroup` can create duplicate `__solo__` groups for one user

**Consensus:** 1/3 — multipass #6.
**Severity:** minor
**Location:** `src/lib/movie-sessions.ts:24-46`; schema has no supporting constraint
(`migrations/0001_initial_schema.sql`, `groups` is unique on `invite_code` only)

**Is this one of the two accepted races? No — and I checked.** The accepted races, per
`dev/research/plan-review-round2.md:101` and the in-code comment at
`src/app/api/movie-sessions/[id]/match/route.ts:92-93`, are the two *check-then-act on a limit*
patterns: the group-join rate limit and the match round limit. Both were accepted on the grounds
that the blast radius is one extra allowed operation. This is a different pattern — a
**bootstrap / get-or-create** race whose blast radius is a permanently duplicated identity record,
not one extra operation. It was never surfaced in any plan review. `docs/pitfalls/testing-pitfalls.md`
§5 already carries "**Bootstrap / first-time races.** First-user, first-org, or any 'only if none
exist' flow tested with concurrent attempts. Exactly one must win." — an existing, unmet
discipline. Treating it as accepted would be wrong.

**Evidence.** Check-then-insert with no uniqueness backstop:

```ts
// src/lib/movie-sessions.ts:25-44
const existing = await db.prepare(
  `SELECT g.id FROM groups g JOIN group_members gm ON gm.group_id = g.id
   WHERE gm.user_id = ? AND g.name = ?`).bind(userId, SOLO_GROUP_NAME).first();
if (existing) return existing.id;
const groupId = crypto.randomUUID();
await db.batch([ /* INSERT groups … INSERT group_members … */ ]);
```

Each call generates a fresh `solo-${crypto.randomUUID()}` invite code (line 40), so both
concurrent inserts satisfy the only unique constraint and both succeed.

**Reachability.** Two solo sessions started in quick succession — a double-tap on "Find our
match →" (`src/app/quick/page.tsx:266`, no `disabled` guard while submitting), or two tabs.
`createSoloGroup` is reached from `createMovieSession` whenever `groupId` is null
(`src/lib/movie-sessions.ts:70`).

**Impact.** The user's solo history splinters across multiple hidden groups. No user-visible
breakage today — solo groups are never listed — but any Phase-2 feature keyed on `group_id`
(watch history, tension axes, an "Our Movie Nights" timeline) will silently see a fragmented
history, and the data will already be wrong by then.

**Blast radius.** One caller (`createMovieSession`). A partial unique index on
`groups(name)`-per-member is awkward in SQLite; the cheaper backstop is a unique index on
`group_members(user_id)` filtered to solo groups, which SQLite cannot express directly. The
practical fix is a deterministic invite code plus `INSERT OR IGNORE` and a re-read — contained to
`src/lib/movie-sessions.ts`, but it requires a migration if a constraint is added. Note the fake
D1 is synchronous, so this cannot be reproduced in the current unit suite.

**Fix approach.** Derive the solo group's `invite_code` deterministically from the user id (e.g.
`solo-${userId}`), `INSERT OR IGNORE`, then re-`SELECT` — the existing `UNIQUE(invite_code)`
becomes the backstop with no migration. Belt-and-braces: also add the client-side
double-submit guard on `/quick`'s CTA.

---

## Design Decisions Requiring User Input

### D1. Should the refinement guarantees have a code-level backstop, or stay prompt-only?

**Location:** `src/lib/matching.ts:229-246` (prompt), `80-150` (`selectCandidates`),
`337-380` (`parseMatchingResponse`)
**Flagged by:** holistic (Design Concerns), reinforced by exploratory #5 and multipass #2.

**The concern.** "Keep these", "never recommend these again", and discovery mode's "do not
recommend anything from their lists" are all *instructions in the system prompt*. Only discovery
mode has a matching code-level filter — `selectCandidates` drops `referencedIds`
(`matching.ts:130`). Kept and removed titles have none: `validTmdbIds` in `parseMatchingResponse`
is the full candidate set (`matching.ts:482`). The codebase already demonstrates the pattern and
applies it inconsistently.

**Why this needs a decision.** It is the difference between fixing B3's symptom and making B3
impossible. Adding a filter also changes model behavior in a way you may not want: after 8 rounds
of heavy rejection, a hard filter could starve the candidate pool below what the model needs to
return 5-7 picks, converting a soft failure ("a rejected film came back") into a hard one
(`thin_results`). That trade is a product call.

**Options.**

| Option | Pros | Cons |
|---|---|---|
| A. Prompt-only (status quo) + fix B3's truncation direction | Smallest change; pool stays full | Guarantee remains aspirational; the model can still ignore the instruction |
| B. Filter removed ids out of `selectCandidates` | Makes "never return" structural; B3's truncation becomes harmless; matches the existing discovery-mode pattern | Can shrink the pool; risks more `thin_results` late in a session |
| C. Filter at `parseMatchingResponse` (drop rejected picks post-hoc, like unknown ids) | Pool stays full; reuses the existing `droppedIds` machinery | Can push a round under `MIN_SURVIVING_RECOMMENDATIONS = 3` and waste a paid call |

**Recommendation.** B, with a floor: filter removed ids out of the candidate pool but stop
filtering once the pool would drop below a threshold (say 60), and keep the prompt instruction as
the second line of defence. That preserves the guarantee for the realistic case (≤50 exclusions
against a 200-title cap) without inventing a new failure mode.

---

### D2. Should `resolveIds` be chunked despite sitting exactly *at* D1's ceiling?

**Location:** `src/app/api/titles/search/route.ts:13, 53-65`
**Flagged by:** 3/3 — exploratory, holistic, multipass all filed it as a design concern. Strongest
cross-hunter agreement in the entire hunt.

**The concern.** `MAX_RESOLVED_IDS = 100` and `resolveIds` does `.bind(...ids)` with no `chunk()`.
It is the only `.bind(...spread)` in the codebase that does not go through `chunk` /
`D1_IN_CHUNK_SIZE`; `getTitlesMap` (`src/lib/movie-sessions.ts:278`) and `selectCandidates`
(`src/lib/matching.ts:101`) both do. 100 is the documented D1 maximum, so today it passes — and
`fetchProfileDraft` (`src/lib/session-flow.ts:72-77`) requests exactly `[...new Set([...comfort,
...watchlist])]`, up to exactly 100, in normal use. Zero headroom.

**Why this needs a decision.** PLAT-1's own rule (`docs/pitfalls/implementation-pitfalls.md:61`)
is *"if you can't prove the collection is bounded under 100, chunk it"* — and this collection *is*
provably bounded, at exactly 100. So it is not a PLAT-1 violation by the letter. But the fake D1
throws only at **>100** (`src/test/fake-d1.ts:29-30`, `D1_MAX_BOUND_PARAMS = 100`), so no test can
distinguish "safely at the limit" from "one over": any future fixed parameter added to that
statement, or any bump to the profile list caps, breaks it in production only.

**Options.** (A) Leave it — it is correct today and the caps are documented in a comment.
(B) Chunk it like its two siblings — ~6 lines, no behavior change.
(C) Lower `MAX_RESOLVED_IDS` to 90 — one-line, but silently truncates a full profile's resolution.

**Recommendation.** B. It costs almost nothing, removes a cliff whose only warning sign is a
comment, and makes the codebase uniform on the one pattern that has already caused a production
bug here.

---

### D3. Should the Anthropic call inside the request handler have a wall-clock deadline?

**Location:** `src/lib/matching.ts:390, 479-527`; `src/app/api/movie-sessions/[id]/match/route.ts:129`
**Flagged by:** holistic (Design Concerns).

**The concern.** `runMatching` makes up to 2 app-level attempts (`MAX_ATTEMPTS = 2`, line 484),
each of which the SDK may itself retry once (`new Anthropic({ apiKey, maxRetries: 1 })`, line
390) — up to 4 Sonnet 5 calls with adaptive thinking and a ~200-candidate prompt, all inside one
Worker HTTP request with no deadline. The design doc budgets 5-15 seconds and the client's
`PhasedLoading` narrative is built for that.

**Why this needs a decision.** Bounding it means choosing what the user sees when the deadline
fires — and the error taxonomy is a locked contract (`MATCHING_ERROR_HTTP`, route lines 30-36)
that the UI branches on (`ERROR_FRAMING`, `results/[sessionId]/page.tsx:50-61`). Adding a
deadline means either reusing `timeout` (cheap, slightly dishonest) or extending the taxonomy
(more correct, touches the locked contract and the UI).

**Options.** (A) No deadline (status quo) — simplest, worst tail latency.
(B) `AbortSignal.timeout(N)` around each `callClaude`, mapped to the existing `timeout` kind.
(C) A whole-request budget in `runMatching` that refuses to start attempt 2 if the clock has run
out, mapped to `timeout`.

**Recommendation.** C, with a ~45s budget. It bounds the worst case with no contract change and
no new UI state, and it preserves the retry for the common fast-malformed case.

---

### D4. Should `rate_limit_log` be pruned?

**Location:** `src/lib/groups.ts:181-199`; `migrations/0001_initial_schema.sql` (`rate_limit_log`,
`idx_rate_limit_scope_key`)
**Flagged by:** multipass (Design Concerns).

**The concern.** `logJoinAttempt` inserts a row per join attempt and nothing ever deletes rows
older than the 10-minute window `checkJoinRateLimit` counts against. The table grows without
bound and the index degrades.

**Why this needs a decision.** It is not a bug at Phase 1 volume, and there is already a weekly
cron that could carry the delete for free — but adding work to `runWeeklyRefresh` couples an
unrelated concern to the refresh job, and B6 shows that job already has issues. Alternatively the
cheapest correct answer is a delete-on-write, which adds a statement to every join attempt.

**Options.** (A) Do nothing until volume warrants it. (B) Prune in the weekly cron. (C) Delete
rows older than the window inside `logJoinAttempt`, batched with the insert.

**Recommendation.** C. One extra statement in an already-rate-limited path, no new coupling, no
new scheduled work, and it can never drift out of sync with the window constant because both live
in `src/lib/groups.ts`.

---

### D5. Candidate synopsis text reaches the prompt un-delimited and unbounded

**Location:** `src/lib/matching.ts:193-196` (`firstSentence`), `288-291` (candidate lines),
`226-227` (guardrail)
**Flagged by:** multipass (Design Concerns, injection angle) and exploratory (Design Concerns,
unbounded-length angle). Two facets of one line of code.

**The concern.** Verified both facets:

```ts
// src/lib/matching.ts:193-196
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : clampText(text, 160);
}
```

- **Unbounded (exploratory):** `match[0]` has no clamp. Every other prompt input is clamped
  (`clampText`/`clampTags`/`clampTitleList`). With 200 candidates this is the one input whose size
  is not bounded by construction.
- **Newline injection (multipass):** `.` does not match `\n`, so a synopsis whose first line has
  no `.`/`!`/`?` falls through to `clampText(text, 160)` — which **can** contain newlines, letting
  a synopsis inject extra lines into the pipe-delimited `CANDIDATES` block. TMDB overviews are
  community-editable. The prompt's injection guardrail names only *"The profile data below"*
  (line 227), so candidate text is outside its stated scope.

**Why this needs a decision.** The mitigation is trivial; the question is how much you want the
guardrail to promise. Broadening it to cover the candidate block changes the system prompt, which
means re-running `src/lib/matching.eval.test.ts` and bumping `PROMPT_VERSION` if you consider it
a semantic change.

**Options.** (A) Clamp + strip newlines in `firstSentence`, leave the guardrail alone.
(B) A, plus extend the guardrail sentence to cover the candidate list.
(C) Do nothing — the schema constrains the output shape, so the realistic damage is prompt noise.

**Recommendation.** B. (A) alone is a two-line change and should happen regardless; the guardrail
extension is one sentence and makes the stated scope match the actual attack surface. Bump
`PROMPT_VERSION` with it.

---

### D6. Cron failures are unattributable and cron crashes are invisible

**Location:** `src/lib/cron-handler.ts:43-53, 78-80, 85`; `worker.ts:15-17`
**Flagged by:** exploratory (Design Concerns, `flush()` aggregation) and multipass (Design
Concerns, `waitUntil` with no `.catch`).

**The concern.** Verified both:

- `flush()` swallows a whole batch into `errors += batch.length` with a bare `catch {}` (lines
  50-52), and the per-title `catch { errors++; }` (79) aggregates into the same counter. A
  systematically failing UPDATE (schema drift, a bad `content_type`) produces a single
  `{"event":"cron_refresh","refreshed":0,"errors":200}` line with no way to tell a TMDB outage
  from a D1 write failure. `refreshed += batch.length` (49) also counts statements queued, not
  rows matched.
- `worker.ts:16` is `ctx.waitUntil(runWeeklyRefresh(env))` with no `.catch`. If the stale-titles
  `SELECT` throws, the rejection escapes and **no** `cron_refresh` line is ever emitted — the
  run's absence is the only signal.

**Why this needs a decision.** This is observability, not correctness, and it interacts with B6:
without it you cannot tell whether a B6 fix worked. But it also invites scope creep (structured
error taxonomy for the cron, alerting) that Phase 1 may not want.

**Options.** (A) Do nothing. (B) Minimal: separate `fetch_errors` from `write_errors` in the log
line and add a `.catch` in `worker.ts` that logs a `cron_failed` line. (C) Full per-title error
attribution with sampled error strings.

**Recommendation.** B. Roughly ten lines, and it is a precondition for verifying any B6 fix in
production.

---

### D7. `PUT /api/user/profile` does an N+1 existence check on the ritual's Continue button

**Location:** `src/app/api/user/profile/route.ts:118-126`
**Flagged by:** multipass (Design Concerns).

**The concern.** Verified: one `SELECT 1 FROM titles WHERE tmdb_id = ?` per referenced id, in a
sequential `for` loop — up to 100 D1 round-trips inside a single request, on the ritual's
"Continue →" (`src/app/ritual/page.tsx:132`, which blocks the step until the PUT returns).

**Why this needs a decision.** It is a performance issue with no correctness consequence today,
and the obvious fix (one chunked `IN (...)`) interacts with D2 — it is a *third* place where a
dynamic `IN (...)` would be introduced, so whatever you decide about chunking discipline should
apply here too.

**Options.** (A) Leave it. (B) Replace the loop with one chunked `IN (...)` using
`chunk`/`D1_IN_CHUNK_SIZE`.

**Recommendation.** B, and do it in the same change as D2 so the chunking pattern lands
uniformly. It removes up to 99 round-trips from the most latency-visible button in the ritual.

---

## False Positives

### FP1. "The taste-map weighting note claims 'at your request' for a flag someone else set"

**Flagged by:** holistic (bug #6). Multipass examined the same line and reached a *different*
conclusion (B8 above) — the disagreement is the signal here.

**Why invalid.** The claim rests on the premise that the device holder sets other members'
rough-day flags. The ritual's own copy contradicts it:

```tsx
// src/app/ritual/page.tsx:370-372
<p className="mb-md text-sm text-ash">
  {member.name}, this one&apos;s yours to set.
</p>
```

Each member gets their own step, addressed to them by name, and the app explicitly hands them the
control. This is a pass-the-phone flow, so "At your request" is attributing the flag to the person
the UI asked to set it. Nothing *enforces* that the named member is the one tapping — but that is
a shared-device trust assumption the design has already made and stated in copy, not a defect in
the note's wording. The genuine defect on that same render line is B8 (the note is shown when the
engine cancelled the weighting), which is orthogonal.

### FP2. "The join-code regex is broader than the generating alphabet"

**Flagged by:** holistic (Design Concerns).

**Why invalid.** Verified `CODE_FORMAT = /^[2-9A-Za-z]{8}$/`
(`src/app/api/groups/join/route.ts:9`) does admit `I L O i l o`, which `generateInviteCode`
excludes (`src/lib/groups.ts:8`). But the route's comment claims only that *"a malformed code can
never match a real invite code"* (lines 31-33) — and that invariant **holds**: the regex is a
superset of the generating alphabet, so every real code passes and every code that fails the regex
is genuinely unmatchable. The hunter's residual objection — that structurally-impossible codes
still consume a rate-limit slot — is the documented *intent*, not a leak: the comment at lines
51-52 says attempts are *"Logged for every well-formatted code, whether or not it matches a real
group — this is what rate-limits invite-code enumeration."* Tightening the regex would make
enumeration cheaper, not safer.

### FP3. Exploratory's severity rating on the `tasteMap.overlap` gap (bug #4, "significant")

**Flagged by:** exploratory (bug #4), specifically the claim that the write path is undefended and
that a bad response can "brick the session page permanently".

**Why partially invalid.** The *bug* is real and is confirmed as B13; the **write-path
probability claim is not**. `MATCHING_RESPONSE_SCHEMA` (`src/types/matching.ts:56-68`) declares
`overlap` as `required` with `additionalProperties: false` at every level, and structured outputs
enforce it. Exploratory's list of triggers ("schema not enforced, a future model/SDK change,
`output_config` silently degrading") are all hypothetical regressions, not current behavior. The
one genuinely undefended surface is the *read* path, which exploratory also identified separately
as design concern EDC5 — that is what makes B13 worth fixing, at minor severity.

### Verified-clean notes carried forward

The multipass report closed with seven "checked and found correct" notes, recorded so a later hunt
doesn't re-litigate them. They are not defect claims and so belong to none of the four categories
above; they are carried forward here, spot-checked and confirmed, and counted separately.

- **VC1.** PLAT-1 chunking correctly applied in `getTitlesMap` (`src/lib/movie-sessions.ts:278`)
  and `selectCandidates`' referenced-id lookup (`src/lib/matching.ts:101`). *Confirmed.* (D2 is
  the one remaining exception.)
- **VC2.** No `datetime()` in comparisons — `sqliteIsoNow()` used in `groups.ts:185` and
  `cron-handler.ts:28`; `countMatchesThisMonth` uses an explicit
  `strftime('%Y-%m-01T00:00:00Z','now')` (`movie-sessions.ts:141`). *Confirmed.*
- **VC3.** XSS — no `dangerouslySetInnerHTML` anywhere; `parseBold` emits React text nodes only.
  *Confirmed by grep.*
- **VC4.** Seed SQL injection — `sqlQuote`/`sqlInt`/`sqlFloat` neutralize hostile TMDB fields;
  the 17 columns and 17 values in `titleToInsertStatement` line up (`scripts/seed-lib.ts:42-90`).
  *Confirmed — columns and values counted.*
- **VC5.** Rough-day privacy through the engine — `computeWeightNote` names a favored member only
  when exactly one is favored (`matching.ts:209-217`); `SessionView.roughDay` serializes the
  requester's own flag only (`movie-sessions.ts:156-157, 204`);
  `getSessionMembersWithProfiles` is never serialized to a response. *Confirmed.* (B8 is about the
  note's *truthfulness*, not a privacy leak.)
- **VC6.** Recommendation dedup and id validation in `parseMatchingResponse`
  (`matching.ts:359-376`). *Confirmed.*
- **VC7.** `callClaude` ordering — `APIConnectionError` tested before `APIError` (lines 426-427),
  `stop_reason` branched before text extraction (443-445), text block located by
  `.find(type === "text")` (449). *Confirmed.* Holistic independently validated the same call
  against the `claude-api` skill and agreed.
- **VC8.** OAuth `returnTo` — `validateReturnTo` (`auth.ts:59-69`) plus
  `new URL(returnTo, request.url)` closes the open-redirect path. *Confirmed.*

---

## Bugs Outside Primary Scope

### O1. `CLAUDE.md` §Gotchas documents the wrong cookie prefix

**Flagged by:** exploratory (Design Concerns) and holistic (Scope note) — both correctly
classified it as a doc defect rather than a code bug.

**Verified.** `CLAUDE.md` §Gotchas states the cookie prefix is `tct-` (`tct-session`,
`tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`). The code uses `mn-` consistently:
`src/lib/auth.ts:7-8` (`mn-session`, `mn-refresh`), and the OAuth routes use `mn-oauth-state` /
`mn-oauth-verifier`. The design doc also specifies `mn-`. This is stale boilerplate carried over
from the `twin-cities-tee-times` reference stack (the same origin as `src/lib/db.ts`'s ABOUTME
line).

**Why out of scope.** The defect is in `CLAUDE.md`, not in `src/`, and this hunt was scoped to
source. **Blast radius:** none at runtime — the code is self-consistent and every test passes. The
cost is agent-facing: the next agent that greps for a cookie by the documented name finds nothing
and may "fix" working code. One-line fix, no code change, no test change.

---

## Completeness Check

Every finding from all three hunter reports, deduplicated, with its disposition.

| Source finding | Disposition |
|---|---|
| Exploratory #1 / Holistic #1 / Multipass #5 — refresh rotation race | **B1** |
| Exploratory #2 / Multipass #1 — leave-group doesn't revoke session access | **B2** |
| Exploratory #5 / Holistic #2 / Multipass #2 — removed-titles truncated from wrong end | **B3** |
| Holistic HDC2 — `getAccumulatedRemovedIds` has no `ORDER BY` | folded into **B3** |
| Multipass MDC7 — client and server truncate the same list from opposite ends | folded into **B3** |
| Multipass #4 — transient D1 write kills the session mid-rotation | **B4** |
| Exploratory #3 / Multipass MDC5 — deleted user's name persists in `ai_response` | **B5** |
| Multipass #3 — refresh ordering starves the tail | **B6** (mechanism B, condition corrected) |
| Holistic #4 — permanently-failing titles hold refresh slots | **B6** (mechanism A) |
| Holistic #3 / Multipass #10 — `MONTHLY_MATCH_LIMIT=0` → 2000 | **B7** |
| Multipass #7 — weighting note shown when engine applied none | **B8** |
| Exploratory #6 / Holistic HDC4 — `member_count` vs. joined members | **B9** |
| Exploratory #7 / Holistic HDC5 / Multipass MDC8 — no client-side count caps | **B10** |
| Exploratory #8 — duplicate session via "Back to the mood" | **B11** |
| Multipass #9 / Exploratory EDC2 — paid round discarded on post-call D1 failure | **B12** |
| Exploratory #4 / Multipass #8 — `tasteMap.overlap` unvalidated | **B13** |
| Exploratory EDC5 — `ai_response` is a trusted blob on read | folded into **B13** |
| Holistic #5 / Multipass MDC6 — orphaned groups after account deletion | **B14** |
| Multipass #6 — duplicate `__solo__` groups (bootstrap race) | **B15** (distinct from the two accepted races) |
| Holistic DC — refinement guarantees are prompt-only | **D1** |
| Exploratory EDC1 / Holistic DC / Multipass MDC1 — `resolveIds` at the D1 ceiling | **D2** |
| Holistic DC — no wall-clock guard around the Anthropic call | **D3** |
| Multipass MDC2 — `rate_limit_log` never pruned | **D4** |
| Multipass MDC4 / Exploratory EDC3 — synopsis un-delimited and unbounded in the prompt | **D5** |
| Exploratory EDC4 / Multipass MDC9 — cron failures unattributable and invisible | **D6** |
| Multipass MDC3 — profile PUT N+1 existence check | **D7** |
| Holistic #6 — weighting note says "at your request" for someone else's flag | **FP1** |
| Holistic DC — join-code regex broader than the generating alphabet | **FP2** |
| Exploratory #4 severity claim — write path undefended / "bricks permanently" | **FP3** (bug retained as B13, probability claim rejected) |
| Multipass "verified correct" notes ×7 (+ OAuth `returnTo`) | **VC1-VC8** |
| Exploratory EDC6 / Holistic scope note — `CLAUDE.md` cookie prefix drift | **O1** |
| Exploratory testing note 1 (auth fan-out) | Test Gap Analysis → §5 entry |
| Exploratory testing note 2 (cross-table lifecycle) | Test Gap Analysis → §8 entry |
| Multipass testing-pitfalls candidates ×6 | Test Gap Analysis (5 adopted, 1 merged) |

**Counts:** 15 confirmed bugs + 7 design decisions + 3 false positives + 1 out of scope = **26
dispositions**, plus 8 verified-clean notes carried forward and 10 testing-pitfall candidates
routed to the Test Gap Analysis.

**Unique findings from the three reports:** 26 defect-or-concern findings (8 exploratory bugs + 6
exploratory design concerns + 6 holistic bugs + 7 holistic design concerns + 10 multipass bugs +
9 multipass design concerns = 46 raw, deduplicating to 26 unique). 26 dispositions ≥ 26 unique
findings. ✅ No finding was dropped.

---

## Test Gap Analysis

Reviewed against `docs/pitfalls/testing-pitfalls.md` (the file lives at that path, not
`dev/testing-pitfalls.md`).

### Per-bug

**B1 — refresh rotation race.**
*Do tests exist?* Yes, and one targets this exact branch: `src/lib/auth.test.ts:375`, *"returns
null without clearing cookies when the refresh session doesn't exist in D1 (already claimed or
invalid)"*.
*Why it missed.* The test asserts only the cookie half — `expect(result.headers.has("Set-Cookie"))
.toBe(false)` with the comment *"CRITICAL: must NOT clear cookies"* — and treats
`result.user === null` as the correct outcome. Half the contract was specified and asserted; the
other half (what the loser *gets*, and whether it is distinguishable from being signed out) was
never named. Structurally, `src/test/fake-d1.ts` is synchronous, so no test can express two
requests in flight against the same row; the test simulates the race by never inserting the row.
*Pitfall coverage.* §5 has *"'Use once' tokens consumed correctly … Exactly one must succeed"* —
which this test satisfies. The gap is that "exactly one succeeds" says nothing about the loser.
*Catch test.* Two `authenticateRequest` calls against one seeded session row, then assert the
second returns something a route can distinguish from unauthenticated. Plus a page-level test:
mount `/ritual` with a fan-out where 2 of 3 fetches 401 and assert the flow is not dead-ended.

**B2 — ex-member retains match authority.**
*Do tests exist?* Yes: `src/lib/groups.test.ts:206`, *"removes only the group_members row,
preserving session history"*.
*Why it missed.* The test asserts the *precondition* of the bug as intended behavior — it seeds a
session member, calls `leaveGroup`, and asserts the `session_members` row survives. Correct, and
complete for `leaveGroup` in isolation. Nothing then asks what the ex-member can *do*. No test in
`match/route.test.ts` revokes group membership.
*Pitfall coverage.* None. §8 was an unfilled TODO placeholder. **New entry added.**
*Catch test.* In `match/route.test.ts`: seed a two-member group + session, `leaveGroup` one member,
assert their `POST …/match` is refused while their `GET …/[id]` still succeeds.

**B3 — truncation from the wrong end.**
*Do tests exist?* Yes, and it passes while asserting the wrong thing:
`src/lib/matching.test.ts:489`, *"caps 200-entry title lists at 50 entries each"* —
`expect(all).toContain("Removed-050"); expect(all).not.toContain("Removed-051");`
*Why it missed.* The fixture is `Removed-001…Removed-200` in ascending order, so "the first 50
survive" looks obviously right. The test never encodes *which* entries are semantically newest, so
it cannot distinguish "keeps the 50 that matter" from "keeps the 50 that don't". The route-level
test (`match/route.test.ts:266`) uses only two removed ids — an input below the boundary.
*Pitfall coverage.* §4 has *"Oversized inputs … Where are your truncation/rejection boundaries,
and are they enforced?"* — satisfied. Direction was never in scope. **New entry added.**
*Catch test.* Seed 9 rounds' worth of removals so the union exceeds 50, then assert the *most
recently* removed title appears in the prompt's exclusion block.

**B4 — transient D1 write mid-rotation.**
*Do tests exist?* No. `auth.test.ts` covers rotation success, expiry, missing cookies, malformed
cookies, and the not-found branch — every path where D1 *works*.
*Why it missed.* The fake D1 (`src/test/fake-d1.ts`) has no failure injection at all, so
"the INSERT throws" is not expressible. Nothing in the suite fails a write mid-sequence.
*Pitfall coverage.* §3 has *"Error-path side effects verified"* — close, but it presumes the error
path exists and is entered deliberately; this is a *success* path interrupted. **New entry added.**
*Catch test.* Inject a throwing `prepare` for the `INSERT INTO sessions` statement and assert the
caller is left recoverable (cookies cleared, no exception escaping).

**B5 — deleted name in `ai_response`.**
*Do tests exist?* Yes, five in `src/lib/account.test.ts:54-160` — all asserting what
`deleteAccount` *touches*.
*Why it missed.* Every assertion is scoped to the three tables the function writes. No test reads
`recommendations.ai_response` after a deletion, and no `movie-sessions/[id]/route.test.ts` case
runs a deletion first. Same shape as B2: the mutation is fully tested, the downstream reader is
not.
*Pitfall coverage.* None (same gap as B2). **Covered by the new §8 entry.**
*Catch test.* Seed a session with a persisted round naming two members, delete one account, then
`GET /api/movie-sessions/[id]` as the survivor and assert the deleted user's name is absent.

**B6 — refresh queue starvation.**
*Do tests exist?* Yes, eight in `src/lib/cron-handler.test.ts:61-230`, including
*"orders refresh candidates by popularity DESC"* (81) and *"caps refresh candidates at 200"* (98)
and *"continues past a per-title fetch failure, counting it as an error"* (147).
*Why it missed.* Every one of them is a **single-run** test. The ordering test proves the right
200 are picked *this* run; the failure test proves the run survives *this* failure. Nothing runs
the job twice against a dataset larger than the limit and asks whether the second run makes
progress — which is the only way either mechanism shows up.
*Pitfall coverage.* §4 has *"Cleanup and eviction"* and *"Bounded growth"*, both about state
growth, not queue progress. **New entry added.**
*Catch test.* Seed 400 titles, run `runWeeklyRefresh` twice with the clock advanced 7 days, assert
the second run fetches a disjoint (or at least substantially different) id set. Plus: a title that
always 404s must not be re-selected indefinitely.

**B7 — `MONTHLY_MATCH_LIMIT=0`.**
*Do tests exist?* Yes: `match/route.test.ts:334` sets the limit explicitly via
`fakeEnv(db, "1")` — the helper at line 27 takes `monthlyLimit?: string` and injects it.
*Why it missed.* The suite tests the value *absent* (every other case omits the argument, using
the 2000 default) and one *truthy* value (`"1"`). Zero, the one operationally critical value, sits
between them and was never tried.
*Pitfall coverage.* §6 has *"Default values are tested. What does the code do when a config value
is absent?"* — satisfied, and precisely why the gap survived: the checklist asks about *absent*,
not *falsy-but-present*. **New entry added.**
*Catch test.* `fakeEnv(db, "0")` and assert the first match attempt is refused with
`kind: "monthly_cap"`.

**B8 — false weighting note.**
*Do tests exist?* Yes: `src/components/taste-map.test.tsx:110` and `:122` cover the note shown and
the note absent.
*Why it missed.* Both pass `showWeightingNote` **directly as a prop**
(`<TasteMap tasteMap={TWO} showWeightingNote />`). The bug is entirely in the *derivation* of that
prop at `results/[sessionId]/page.tsx:350`, which no test exercises against a session where both
members toggled. A component test that receives a derived value as an input can never test the
derivation.
*Pitfall coverage.* §7 *"Test doubles are minimal and honest"* is adjacent but about mocks, not
props. This is a one-off shape rather than a general discipline — **noted here, not added to the
file** (it would duplicate the honest-fixture item at §7 without sharpening it).
*Catch test.* A results-page test with a two-member session where both `session_members.rough_day`
rows are set, asserting no `weighting-note` testid renders.

**B9 — `member_count` counts deleted members.**
*Do tests exist?* Yes, and they bracket the bug without hitting it:
`movie-sessions.test.ts:365-398` covers solo, one-member-regular-group, and two-member cases;
`:434` covers *"skips session members whose user row no longer exists (deleted accounts)"*.
*Why it missed.* The two behaviors were tested in separate `describe` blocks against separate
fixtures. No fixture has a deleted member *and* asks for the session view. Classic cross-table
lifecycle gap.
*Pitfall coverage.* **Covered by the new §8 entry.**
*Catch test.* Seed a two-member session, `deleteAccount` one, then assert `getSessionForMember`
returns `solo: true` for the survivor and that it agrees with
`getSessionMembersWithProfiles(...).length`.

**B10 — no client-side count caps.**
*Do tests exist?* `src/components/tag-picker.test.tsx` and `title-search.test.tsx` exist; the
profile route tests cover the 400s (`user/profile/route.test.ts`).
*Why it missed.* Client and server were tested on opposite sides of the boundary and nobody tested
the boundary itself. No test selects 31 tags in `TagPicker` and asserts the component refuses.
*Pitfall coverage.* §4 *"Oversized inputs"* covers the server side, which is correct. The gap —
"a client-side control must not be able to construct a payload its server rejects" — is real but
narrower than a general discipline; **noted here, not added.**
*Catch test.* Select all 30 presets in `TagPicker`, add a custom tag, assert `onChange` was not
called with 31 entries.

**B11 — duplicate sessions via "Back to the mood".**
*Do tests exist?* `src/app/ritual/page.test.tsx` and `quick/page.test.tsx` exist and cover the
error screen and "Try again".
*Why it missed.* The tests exercise one pass through the error screen. Nothing takes the *second*
route out (back to the mood, then submit again) and counts `movie_sessions` rows. State-machine
tests that only walk forward miss the state a back-edge leaves behind.
*Pitfall coverage.* None precisely; §7 *"No shared mutable state between tests"* is about the
suite, not the component. **Noted here, not added** — one-off.
*Catch test.* Fail the match, click "Back to the mood", click "Find our match →", assert
`startSession` was called once, not twice.

**B12 — paid round discarded.**
*Do tests exist?* Yes: `match/route.test.ts:432`, *"failed rounds are not persisted (no
recommendations row)"* — but that covers the failure occurring *before* the write.
*Why it missed.* Same root as B4: the fake D1 cannot be made to fail a specific statement, so
"the write fails after the call succeeded" is unreachable in the current harness.
*Pitfall coverage.* **Covered by the new §3 entry** (partial failure of a multi-write sequence).
*Catch test.* Make the second `getTitlesMap` throw and assert a 200 with an empty `titles` map,
not a 500.

**B13 — `tasteMap.overlap` unvalidated.**
*Do tests exist?* Yes: `matching.test.ts:557`, *"throws malformed on JSON that is not a
MatchingResponse shape"*.
*Why it missed.* The fixture omits a field the guard *does* check. Negative-shape tests written
against the implementation's own condition list can only ever confirm that list — they cannot
reveal what the list omits. Nothing tests the read path
(`movie-sessions/[id]/route.test.ts`) with a malformed stored `ai_response`.
*Pitfall coverage.* §4 *"Empty / null / zero inputs"* nominally covers it. The sharper discipline
— "derive negative-shape fixtures from the type/schema, not from the validator" — is worth
recording but is a one-off here given the JSON schema already exists to enumerate against.
**Noted, not added.**
*Catch test.* Store an `ai_response` with `tasteMap.members` present and `overlap` missing, then
assert the session GET degrades to `response: null` rather than serving it.

**B14 — orphaned groups.** *Do tests exist?* `account.test.ts:55` asserts the cascade of
`group_members`. *Why it missed.* Same cross-table shape as B2/B5/B9 — the test asserts what
cascades, never what is left behind. **Covered by the new §8 entry.**
*Catch test.* Delete the sole member of a group, then assert `joinGroup` with its invite code
returns null.

**B15 — duplicate `__solo__` groups.** *Do tests exist?* Yes:
`movie-sessions.test.ts:131`, *"reuses the existing solo group on subsequent calls"* — sequential,
which is exactly what passes.
*Why it missed.* `src/test/fake-d1.ts` is synchronous (`node:sqlite`'s `DatabaseSync`) and cannot
interleave two callers, so no concurrent test is expressible. `testing-pitfalls.md` §5 already
carries *"Bootstrap / first-time races … Exactly one must win"* — the discipline was documented
and unenforceable. **A note recording that unenforceability is added under §5** rather than a new
checklist item, since the item already exists.
*Catch test.* Requires either an async-capable fake with an injectable yield point between
statements, or Miniflare-backed integration tests. Not closeable in the current harness.

### Testing Pitfalls Updates

I evaluated the multipass report's six proposed entries and exploratory's two proposed entries.
(The holistic report ends with Design Concerns and proposed no testing entries, contrary to the
dispatch brief.) Adopted six, merged two, and rejected none outright — but reframed the §5 item
and folded exploratory's fan-out angle into it rather than adding a parallel entry.

Added to `docs/pitfalls/testing-pitfalls.md`:

1. **§3 Error Path Coverage** — *"Partial failure of a multi-write sequence is tested at each
   step."* (from B4, also covers B12). Adopted from multipass, unchanged in substance.
2. **§4 Negative Property Testing** — *"Truncation direction is asserted, not just the cap."*
   (from B3). Adopted; strengthened with the observation that the existing test asserts the wrong
   direction while passing.
3. **§4 Negative Property Testing** — *"Repeat invocations of a batch job make forward progress."*
   (from B6). Adopted; the multipass framing ("never refreshed, forever") was softened to match
   the corrected analysis in B6.
4. **§5 Concurrency & TOCTOU** — *"The loser of a single-use claim is asserted, not just the
   winner."* (from B1). Adopted, with exploratory's client-fan-out angle merged in as the second
   sentence rather than a separate item.
5. **§5 Concurrency & TOCTOU** — a note recording that the synchronous fake D1 makes the section's
   concurrency items unprovable in the unit suite, and what closing them would require. Adopted
   from the multipass report's closing note.
6. **§6 Boundary & Configuration Validation** — *"Falsy-but-valid config values are tested, not
   just absent ones."* (from B7). Adopted, unchanged in substance.
7. **§8 (replacing the TODO placeholder) — new topic section "Cross-Table Lifecycle &
   Authorization Freshness"**, with three items: authorization re-tested after revocation; read
   access and write/spend access tested separately after revocation; and every reader keyed on a
   surviving key asserted after a mutation deletes or anonymizes rows. The first two are
   multipass's; the third is exploratory's cross-table item, which covers B5, B9 and B14 and does
   not fit under an "authorization" heading alone — hence the broader section title.

Gaps deliberately **not** promoted to the file, noted per-bug above instead: B8 (component test
receives a derived prop directly), B10 (client control can construct a server-rejected payload),
B11 (state-machine back-edge untested), B13 (negative-shape fixtures derived from the validator
rather than the schema). Each is a one-off shape here, and adding four more items would dilute a
checklist whose value depends on every item earning its place.
