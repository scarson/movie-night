# Bug Hunt Report — Phase 1, Exploratory (depth-first)

**Date:** 2026-08-01
**Base:** `origin/dev` @ 382394e (read-only worktree `bug-hunt-2026-08-01`)
**Method:** `code-bug-hunter-exploratory` — start at the highest-risk coordinators, follow threads to callers/callees/siblings.

---

## Scope

Read in full and explored deeply (chosen because they coordinate multi-step flows,
manage cross-request shared state, or sit on the authorization boundary):

- `src/lib/auth.ts` — the refresh-token rotation is the one place in the app where a
  request mutates state that *every other concurrent request* depends on. Followed to
  every route that calls `authenticateRequest`, and to the client pages that fan out
  requests in parallel.
- `src/lib/movie-sessions.ts` + `src/lib/groups.ts` + `src/lib/account.ts` — the
  membership model is split across three tables (`group_members`, `session_members`,
  `users`) with three different lifecycles. Followed each mutation (join / leave /
  delete-account) forward into every reader.
- `src/lib/matching.ts` — prompt assembly, the Anthropic call, and the defensive parse.
  Followed the parsed object all the way to `taste-map.tsx` / `ranked-list.tsx` render.
- `src/app/api/movie-sessions/[id]/match/route.ts` — the longest transaction in the app
  (7 D1 reads → ~30s network call → write → read). Followed every failure branch.
- `src/lib/db.ts`, `src/lib/cron-handler.ts`, `src/lib/tmdb.ts`, all routes under
  `src/app/api/`, `migrations/0001_initial_schema.sql`, `src/types/db.ts`,
  `src/types/matching.ts`, `worker.ts`.

Read for cross-checking, not explored deeply: `src/app/results/[sessionId]/page.tsx`,
`ritual`, `quick`, `tonight`, `profile`, `groups`, `groups/join/[code]` pages;
`refine-panel`, `ranked-list`, `taste-map`, `title-search`, `tag-picker`,
`profile-editor`, `group-picker`, `phased-loading`, `bold-text`, `auth-provider`.

Not explored: pure presentational components (`chip`, `poster`, `skip-link`,
`site-footer`, `progress-steps`, `toggle-row`, `control-classes`), `reduced-motion`,
`globals.css`, all `*.test.*` files.

**Deliberately excluded per brief** (not reported): the group-join rate-limit TOCTOU
and the match round-limit TOCTOU.

---

## Bugs

### 1. Parallel authenticated requests race the single-use refresh token — all but one get 401

**Location:** `src/lib/auth.ts:115-125`; triggered by
`src/app/profile/page.tsx:97`, `src/app/ritual/page.tsx:76-80`
**Severity:** significant

**Evidence:**
`authenticateRequest` claims the refresh session with `DELETE … RETURNING`, and any
request that loses that claim returns `user: null` with no retry:

```ts
const claimed = await db
  .prepare("DELETE FROM sessions WHERE token_hash = ? RETURNING user_id, expires_at")
  .bind(tokenHash).first<…>();
if (!claimed) {
  // "already claimed by a concurrent request, or the token was never valid"
  return { user: null, headers };
}
```

The comment treats concurrent claims as benign, but the session cookie's lifetime is
pinned to the 15-minute JWT (`Max-Age=900`, `auth.ts:188`), so after 15 idle minutes the
browser sends *only* `mn-refresh` and **every** request must go through this path.

Two client pages fan out authenticated requests in parallel from a single effect:

- `src/app/profile/page.tsx:97` — `Promise.all([fetchProfileDraft(), fetchQuickPicks()])`
- `src/app/ritual/page.tsx:76-80` — `Promise.all([fetchProfileDraft(), fetchQuickPicks(), fetchGroup(groupId)])`

Both effects are gated on `user` being non-null, which is already true on a client-side
navigation (AuthProvider fetched `/api/auth/me` once, at layout mount — `auth-provider.tsx:32-49`).
So: open the app, use it, wait >15 minutes, click through to `/profile` or `/ritual` →
2–3 requests fire simultaneously, all carrying the same `mn-refresh` value, one wins,
the rest get 401.

**Impact:** `fetchProfileDraft` returns `null` on any non-OK response
(`session-flow.ts:24-32`), which the page renders as *"We couldn't load your profile.
Reload the page rather than starting again from scratch"* (`profile/page.tsx:157-162`)
and the ritual renders as a hard flow-stop (`ritual/page.tsx:83-86`). The user is told to
reload — and reload does fix it, because the winning request already installed fresh
cookies — but the failure is deterministic for the fan-out pages after every idle window,
and it is indistinguishable from a real backend outage. Nothing in the app retries a 401.

---

### 2. Leaving a group does not revoke access to that group's sessions, or to other members' *live* profile data

**Location:** `src/lib/groups.ts:173-178` (`leaveGroup`),
`src/lib/movie-sessions.ts:164-206` (`getSessionForMember`),
`src/app/api/movie-sessions/[id]/match/route.ts:87-121`
**Severity:** significant

**Evidence:**
`leaveGroup` deletes only the `group_members` row:

```ts
await db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
```

But session authorization is keyed on `session_members`, not `group_members`:

```sql
FROM movie_sessions ms
JOIN session_members sm ON sm.session_id = ms.id AND sm.user_id = ?
```

and `session_members` rows are written once at session creation
(`movie-sessions.ts:102-108`) and never cleaned up. `GET /api/groups/[id]` correctly
404s an ex-member (`groups.ts:137-141` checks `group_members`), so the *group* surface
is closed — but the *session* surface is not.

Critically, `POST /api/movie-sessions/[id]/match` is reachable by an ex-member, and it
does not replay stored data — `getSessionMembersWithProfiles` (`movie-sessions.ts:225-260`)
reads the **current** `profiles` table:

```sql
LEFT JOIN profiles p ON p.user_id = sm.user_id
```

**Impact:** after a couple splits and one person leaves the group, the person who left
can still open any old session URL and press "Regenerate", getting a freshly-generated
taste map, explanations, and conversational write-up derived from the other person's
*present-day* comfort films, watchlist, vibes and dealbreakers — updated after the
split. The design doc (`dev/plans/design-doc.md:275`) intends session_members to persist
so *history* survives; it does not intend leaving to leave a live read channel open.
Note the group-join page's own copy promises the opposite: *"Joining … shares your taste
profile with its other members. You can leave any time."*
(`src/app/groups/join/[code]/page.tsx:92-95`).

---

### 3. Account deletion leaves the deleted user's real name in every persisted round, contradicting the product's explicit "[deleted user]" promise

**Location:** `src/lib/account.ts:4-17`;
`src/app/api/movie-sessions/[id]/route.ts:33-41`;
promise text at `src/app/profile/page.tsx:233-237` and `src/app/privacy/page.tsx:86-91`
**Severity:** significant

**Evidence:**
`deleteAccount` anonymizes the `session_members.user_id` join key and hard-deletes the
`users` row. It never touches `recommendations.ai_response`, which stores the **full
`MatchingResponse` JSON** (`migrations/0001_initial_schema.sql:74`,
`movie-sessions.ts:340`). That JSON carries the member's real name in
`tasteMap.members[].name` — the model is fed each member's name (`matching.ts:276`) and
required to echo it back (`types/matching.ts:52`) — and in `conversational`, which the
prompt instructs to *"Reference members by name"* (`matching.ts:259`).

`GET /api/movie-sessions/[id]` returns that blob verbatim to any remaining session
member:

```ts
const response = latest ? parseJsonColumn<MatchingResponse | null>(latest.ai_response, null) : null;
```

and `taste-map.tsx:63` renders `{member.name}` directly.

Meanwhile the strings `[deleted user]` and `Former member` appear **nowhere** in
`src/**` outside the two pages that promise them (verified by grep — only
`privacy/page.tsx:90` and `profile/page.tsx:235`, plus their tests).

**Impact:** the app tells a departing user, at the moment of an irreversible action,
*"your name replaced by '[deleted user]'"*. It is not. Every past taste map and
write-up their ex-partner can still open keeps naming them. This is a false statement in
a privacy disclosure, not just a missing feature. (`dev/research/plan-review-round4.md:41`
flagged this exact surface — *"7.5 taste map uses AI-response names"* — and recommended
rendering a "Former member" placeholder; nothing was implemented.)

---

### 4. `parseMatchingResponse` never validates `tasteMap.overlap`, and the unvalidated object is persisted — one bad response bricks the session page permanently

**Location:** `src/lib/matching.ts:346-357`; consumed at `src/components/taste-map.tsx:89,164,166,174`
**Severity:** significant

**Evidence:**
The defensive parse — explicitly labelled *"Structured outputs guarantee the schema, but
parse defensively anyway"* — checks five things and omits the sixth:

```ts
if (shaped === null || typeof shaped !== "object" ||
    typeof shaped.conversational !== "string" ||
    !Array.isArray(shaped.recommendations) ||
    shaped.tasteMap === null || typeof shaped.tasteMap !== "object" ||
    !Array.isArray(shaped.tasteMap.members)) {
  throw new MatchingError("malformed");
}
```

`shaped.tasteMap.overlap` is never checked, nor are the per-member fields. `TasteMap`
then does `const { members, overlap } = tasteMap` and dereferences
`overlap.summary`, `overlap.sharedVibes.length`, `overlap.tensionPoints.length` — and
`member.primaryVibes.length` / `member.genreAffinities.length` at line 66 — with no
guards.

The ordering makes this a poison pill rather than a one-off render error:
`runMatching` returns → `insertRecommendation` **persists** the object
(`match/route.ts:154-162`) → only then is it rendered. `GET /api/movie-sessions/[id]`
re-serves the stored blob with even less validation than the parse path
(`parseJsonColumn` with a `null` fallback, no shape check).

**Impact:** if a response ever arrives with `members` present but `overlap` missing
(schema not enforced, a future model/SDK change, `output_config` silently degrading, or
a corrupted `ai_response` column), the results page throws on every subsequent load of
that session. The retry-on-`malformed` path in `runMatching:522` cannot help, because
the object passed validation. The user has no way back to the refine panel or to a fresh
round for that session — only "Start over". Low probability, but the code's own stated
contract is to defend here, and it defends every field *except* the two whose absence is
fatal.

---

### 5. Accumulated removed-title exclusions are truncated to the *oldest* 50, so recent rejections silently stop being excluded

**Location:** `src/lib/matching.ts:185-187` + `233-245`;
`src/lib/movie-sessions.ts:125-135`; compare `src/app/results/[sessionId]/page.tsx:221-223`
**Severity:** minor

**Evidence:**
`getAccumulatedRemovedIds` returns `[...ids]` from a `Set` built by iterating
`recommendations` rows — insertion order, i.e. **oldest round first**. The match route
unions that with this round's removals in the same order
(`match/route.ts:117-119`), and `buildMatchingPrompt` clamps with:

```ts
function clampTitleList(titles: string[]): string[] {
  return titles.slice(0, MAX_TITLE_LIST_ENTRIES);   // first 50
}
```

The client caps the same list in the **opposite** direction — `.slice(-MAX_ID_LIST_ENTRIES)`,
keeping the newest 50 (`results/[sessionId]/page.tsx:221-223`) — so the two ends of the
pipeline disagree about which removals matter.

With 5–7 recommendations per round (`matching.ts:267`) and a 10-round budget, a user who
rejects most picks crosses 50 accumulated exclusions around round 8.

**Impact:** past that point the `"Do NOT recommend any of these movies (already
rejected)"` block in the prompt lists only the rejections from rounds 1–7 and drops the
ones the user *just made*. The model is then free to re-suggest exactly the film that
was rejected one round ago — the most visible possible failure of the refinement loop,
and one that only bites the users who engaged with it hardest.

---

### 6. `getSessionForMember.member_count` counts anonymized deleted members, so `solo` disagrees with the actual prompt membership

**Location:** `src/lib/movie-sessions.ts:173` and `202`, vs `225-260`
**Severity:** minor

**Evidence:**
Solo-ness is derived from a raw row count:

```sql
(SELECT COUNT(*) FROM session_members WHERE session_id = ms.id) as member_count
```
```ts
solo: row.member_count < 2,
```

but the members actually fed to the prompt come from a query that **inner-joins `users`**
and therefore drops deleted accounts (`getSessionMembersWithProfiles:231-236`, comment:
*"Members whose user row is gone (deleted accounts) are skipped"*). `deleteAccount`
rewrites `session_members.user_id` to a `deleted-xxxxxxxx` sentinel rather than deleting
the row (`account.ts:9-11`), so the count still sees it.

**Impact:** after one member of a two-person session deletes their account, the surviving
member's session reports `solo: false` while exactly one member is sent to the model. The
prompt then asks a single-member "group" to *"find where their tastes overlap"* and to
populate `tensionPoints` with *"the key taste conflicts"* (`matching.ts:224,255`) — the
solo-specific prompt variant, which exists precisely for this shape, is skipped. The
rendered page is also internally inconsistent: `TasteMap` computes its own
`solo = members.length < 2` (`taste-map.tsx:90`) and shows solo copy, while
`session.solo` said otherwise.

---

### 7. The tag and title pickers enforce no count limit, so a reachable selection makes every save 400

**Location:** `src/components/tag-picker.tsx:29-47` and `src/components/profile-editor.tsx:99-116`,
vs `src/app/api/user/profile/route.ts:11-13,40-47` and `src/app/api/movie-sessions/route.ts:9-28`
**Severity:** minor

**Evidence:**
`TagPicker` caps tag *length* (`maxLength={MAX_TAG_LENGTH}`, line 85) but never the tag
*count*. The preset vocabulary is 16 `MOOD_TAGS` + 14 `GENRE_TAGS` = **exactly 30**
(`src/config/tags.ts:3-13`), and the server cap is also 30
(`MAX_TAG_LIST_ENTRIES = 30`). Selecting every preset chip and then adding one custom
tag yields 31 and a hard `400 "vibes can hold at most 30 entries"`. The same picker
feeds `moodVibes` on the mood screen, against the identical 30-cap in the
movie-sessions route. `TitleSearch` likewise has no cap against
`MAX_TITLE_LIST_ENTRIES = 50`.

**Impact:** the failure surfaces late and far from the cause — in the ritual it blocks
"Continue →" at step 0 (`ritual/page.tsx:129-139`), and for `moodVibes` it surfaces as
the full-page *"Not tonight, apparently"* error screen. Nothing in the UI indicates a
limit exists or which entry to remove. Every chip is tappable right up to the point
where the profile becomes unsavable.

---

### 8. A failed match followed by "Back to the mood" creates a duplicate session on every retry

**Location:** `src/app/ritual/page.tsx:152-173, 216-224`; same shape at `src/app/quick/page.tsx:117-139, 181-190`
**Severity:** minor

**Evidence:**
`submit()` unconditionally calls `startSession(...)` — it never checks the `sessionId`
state it already set. The "Try again" button correctly branches
(`if (sessionId !== null) runMatch(sessionId) else submit()`), but the *"Back to the
mood"* button clears only `matching` and `matchError`:

```ts
onClick={() => { setMatching(false); setMatchError(null); }}
```

leaving `sessionId` populated. The user is then returned to the mood step, where the
only CTA is `onClick={() => void submit()}`.

**Impact:** each pass through the error screen via "Back to the mood" writes another
`movie_sessions` row plus one `session_members` row per member, all orphaned (no
recommendation ever attaches to them). It also silently resets the 10-round budget,
since `getRoundNumber` counts per-session. Cheap per occurrence, but it is the most
likely path a user takes after a `thin_results` or `timeout` failure.

---

## Design Concerns

*(patterns that raise bug risk — not coverage gaps, not style)*

- **`/api/titles/search?ids=` is the one dynamic `IN (…)` still unchunked, and it sits
  exactly on the D1 ceiling.** `MAX_RESOLVED_IDS = 100` and `resolveIds` does
  `.bind(...ids)` with no `chunk()` (`titles/search/route.ts:13,53-61`) — the only
  `.bind(...spread)` in the codebase that doesn't go through `chunk`/`D1_IN_CHUNK_SIZE`
  (the other two, `matching.ts:107` and `movie-sessions.ts:285`, do). 100 is the
  documented D1 limit, so it should pass, but it has zero headroom and deviates from the
  pattern PLAT-1 established after the last hunt. Worse, the fake D1 throws only at
  **>100** (`src/test/fake-d1.ts:20`), so a regression that pushes this to 101 would be
  caught, but the current zero-margin design is invisible to tests. Chunk it.

- **Money is spent before the round is recorded.** `match/route.ts` calls Claude
  (line 129) and only then `insertRecommendation` (line 154). Any D1 failure on that
  insert throws into the generic 500 handler; the ~$0.04 call is lost, the round isn't
  counted, and the user sees "Match failed" with no result. Because `getRoundNumber`
  counts `recommendations` rows, a repeatedly-failing insert also means the round limit
  never advances.

- **`firstSentence` is the only unbounded string in the prompt.**
  `matching.ts:193-196` returns `match[0]` — the whole first sentence, however long —
  and only falls back to a 160-char clamp when *no* terminal punctuation is found. Every
  other prompt input is clamped. With 200 candidates this is the one input whose size
  isn't bounded by construction.

- **`cron-handler.flush()` counts failures without identifying them.**
  `cron-handler.ts:50-52` swallows a whole batch into `errors += batch.length` with a
  bare `catch {}`. A systematically failing UPDATE (schema drift, a bad `content_type`)
  produces a single `{"event":"cron_refresh","refreshed":0,"errors":200}` line with no
  way to tell a TMDB outage from a D1 write failure — the per-title `catch { errors++ }`
  at line 78 aggregates into the same counter.

- **`ai_response` is a trusted blob on read.** `movie-sessions/[id]/route.ts:38` runs
  `parseJsonColumn<MatchingResponse | null>` with a `null` fallback, so anything that
  parses as JSON is handed to the renderer as a `MatchingResponse`. The write path at
  least attempts validation; the read path does none. This is the same root as bug #4.

- **Doc drift on cookie names.** `CLAUDE.md` §Gotchas states the cookie prefix is
  `tct-` (`tct-session`, `tct-refresh`, `tct-oauth-state`, `tct-oauth-verifier`). The
  code consistently uses `mn-` (`auth.ts:7-8`, `auth/google/route.ts:45-46`,
  `auth/google/callback/route.ts:21-22`, `auth/logout/route.ts:14`). The code is
  self-consistent — this is a stale doc, not a bug — but it will mislead the next agent
  that greps for a cookie by the documented name.

---

## Notes for `docs/pitfalls/testing-pitfalls.md`

Two of the findings above are of a class the current suite structurally cannot catch,
and are worth an entry:

1. **Bugs #1 (refresh-token race)** — `src/test/fake-d1.ts` is synchronous, so no test
   can express "two requests in flight against the same refresh row". Route tests call
   handlers one at a time. The pitfall to record: *authorization state that is consumed
   (single-use tokens, claim-by-DELETE) must be reasoned about at the level of the
   client's request fan-out, not the handler — enumerate every `Promise.all` of
   authenticated fetches and check that N-1 of them failing is acceptable.*

2. **Bug #2 (leave-group doesn't revoke session access) and #6 (`member_count` vs
   joined members)** — both are *cross-table lifecycle* bugs: a mutation on table A
   (`group_members`, `users`) leaves a reader keyed on table B (`session_members`)
   authorizing or counting stale rows. Unit tests that exercise each function in
   isolation pass. The pitfall to record: *for every row a mutation deletes or
   anonymizes, grep for every query that still joins or counts on the surviving key, and
   assert the post-mutation read — not just the mutation's own effect.*
