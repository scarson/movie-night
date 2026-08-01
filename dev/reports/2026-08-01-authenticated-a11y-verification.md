# Authenticated-surface a11y verification — local session runbook + 1.4.10 at 320px

**Date:** 2026-08-01
**Branch:** `claude/auth-surface-verification`
**Closes:** the environment block recorded in `dev/reports/2026-08-01-reflow-400pct.md`, where
`next dev` had no Cloudflare bindings, `/api/auth/me` 500'd, and every auth-gated route took
its signed-out redirect before rendering.

---

## Part 1 — Runbook: a locally signed-in session in ~5 minutes

No Google OAuth, no external credentials, no deployed environment. The whole trick is that
`authenticateRequest()` only needs (a) a JWT signed with the same `JWT_SECRET` the Worker
boots with, or (b) a `sessions` row whose `token_hash` matches the `mn-refresh` cookie.
Both are things you can manufacture locally.

### What the auth module actually requires

From `src/lib/auth.ts`:

| Thing | Value |
|---|---|
| Session cookie | `mn-session` — the JWT, `Max-Age=900` (15 min) |
| Refresh cookie | `mn-refresh` — an opaque UUID, `Max-Age=90 days` |
| Algorithm | HS256 via `jose`, key = `new TextEncoder().encode(JWT_SECRET)` |
| Claims | `{ userId, email }` + `exp` (15m) + `iat`. Both claims must be strings or `verifyJWT` returns null |
| Refresh storage | `sessions.token_hash` = **SHA-256 hex** of the raw refresh token (`sha256()`) |
| Cookie flags | `HttpOnly; SameSite=Lax; Path=/`, `Secure` only when the request URL is `https://` |

`HttpOnly` matters only for server-set cookies — a cookie set from `document.cookie` without
it is still sent on every request, so the browser side is a two-line JS snippet.

### Step 1 — `.dev.vars` (gitignored, confirmed via `git check-ignore`: `.gitignore:94`)

```
JWT_SECRET=local-a11y-verification-secret-do-not-use-in-production
GOOGLE_CLIENT_ID=local-dummy-client-id
GOOGLE_CLIENT_SECRET=local-dummy-client-secret
ANTHROPIC_API_KEY=sk-ant-local-dummy-not-called
TMDB_API_TOKEN=local-dummy-not-called
MONTHLY_MATCH_LIMIT=100
```

The Anthropic and TMDB values are never exercised — nothing in this pass calls either API.
**Do not click "Find our match" / "Show me different options"** with a dummy key: it fires a
real `POST /api/movie-sessions/[id]/match` and 500s on `authentication_error`. Seed a
`recommendations` row instead (Step 3).

### Step 2 — local D1 schema

```bash
npm run migrate:local
```

### Step 3 — fixture rows

Insert directly; there is no signup path to walk. Minimum for full coverage is two users
(so the taste map has two members), a profile each, a two-member group, a `movie_sessions`
row with `session_members`, and one `recommendations` row holding a `MatchingResponse` JSON.

```bash
npx wrangler d1 execute movie-night-db --local --command="
INSERT INTO users (id, google_id, email, name, avatar_url, created_at) VALUES
  ('user-a11y','google-a11y-1','alexandra.verification@example.test','Alexandra Featherstonehaugh',NULL,'2026-07-01T12:00:00.000Z');
INSERT INTO profiles (user_id, comfort_titles, watchlist, vibes, dealbreakers, streaming_services, updated_at) VALUES
  ('user-a11y','[27205,155,680]','[157336]','[\"Cozy\",\"Cerebral\",\"Slow-Burn\",\"Mind-Bending\",\"Drama\",\"Sci-Fi\"]','[\"Horror\",\"True Crime\"]','[\"Netflix\",\"Max\",\"Criterion Channel\"]','2026-07-01T12:00:00.000Z');
"
```

Two shape traps that cost time and will cost the next person the same:

- **`titles.streaming` is `StreamingInfo`, not the raw TMDB payload.** `flatrate` / `rent` /
  `buy` are `string[]` of provider names (`src/lib/tmdb.ts:101`). Seeding TMDB's
  `[{provider_name: "Netflix"}]` renders `On [object Object]` on the results page.
- **`recommendations.ai_response` is the whole `MatchingResponse`** — `tasteMap.members[]`,
  `tasteMap.overlap`, `recommendations[]`, `conversational` (`src/types/matching.ts`). A
  member `userId` that doesn't match a `session_members.user_id` still renders, but the
  per-person colouring won't line up with anything.

The full fixture used for this pass, including titles and the recommendation JSON, is the
`a11y-fixture.sql` reproduced at the end of this document.

### Step 4 — mint the session

Import the project's own `createJWT` / `sha256` rather than reimplementing them, so the
claims and hash can never drift from what `authenticateRequest` checks. Save as a `.mts`
file (or wrap in an async `main()` — `tsx` transpiles `.ts` to CJS and rejects top-level
`await`):

```ts
import { readFileSync } from "node:fs";
import { createJWT, sha256, REFRESH_EXPIRY_DAYS } from "./src/lib/auth";
import { parseDevVars } from "./scripts/seed-lib";

const USER_ID = "user-a11y";
const EMAIL = "alexandra.verification@example.test";

const secret = parseDevVars(readFileSync(".dev.vars", "utf-8")).JWT_SECRET!;
const jwt = await createJWT({ userId: USER_ID, email: EMAIL }, secret);
const refresh = crypto.randomUUID();
const hash = await sha256(refresh);
const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 86400_000).toISOString();

console.log(JSON.stringify({
  jwt,
  refresh,
  sql: `DELETE FROM sessions WHERE user_id = '${USER_ID}'; INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('${hash}', '${USER_ID}', '${expiresAt}', '${new Date().toISOString()}');`,
  cookieJs: `document.cookie='mn-session=${jwt}; path=/'; document.cookie='mn-refresh=${refresh}; path=/';`,
}, null, 2));
```

Run it, then apply the emitted `sql` with `wrangler d1 execute ... --local`.

**Seed the refresh row even though the JWT alone works.** The JWT expires in 15 minutes,
which is shorter than a measurement session. With a valid `sessions` row the app rotates
silently on the first request after expiry and the browser keeps working — verified: a
request carrying only `mn-refresh` returned `200` plus a fresh `Set-Cookie: mn-session=…`.

### Step 5 — serve with real bindings

`npm run preview` is `opennextjs-cloudflare build && wrangler dev`. Split it so a rebuild
isn't needed on every restart:

```bash
npx opennextjs-cloudflare build            # ~1 min
npx wrangler dev --port 8791 --ip 127.0.0.1
```

Wait for `Ready on http://127.0.0.1:8791` and confirm the bindings block lists
`env.DB … D1 Database … local` and `env.JWT_SECRET … Environment Variable … local`.

**Pick a non-default port.** Sibling agents in other worktrees of this repo run their own
`wrangler dev`; port 8787 was already claimed mid-run, which killed the server underneath a
measurement and produced a spurious `ERR_CONNECTION_REFUSED`. Same applies to the shared
scratchpad and the shared Browser pane — namespace log files, and pass `tabId` explicitly on
every browser call (a sibling opened a second tab and stole both focus and the viewport size
mid-sweep).

### Step 6 — prove you're signed in *before* measuring anything

```bash
curl -s -H "Cookie: mn-session=$JWT" http://127.0.0.1:8791/api/auth/me
# {"userId":"user-a11y","email":"…","name":"Alexandra Featherstonehaugh","avatarUrl":null}
```

Then in the browser, paste the `cookieJs` line and re-check from the page context. Both were
confirmed `200` with the real user body before a single measurement was taken. A bare request
returns `401`, which is the correct negative control — under `next dev` the same route
returned `500`, and that difference is exactly what was blocking this work.

### What this also unblocks

**The screen-reader pass is still not run, and this runbook does not run it.** But it removes
the reason it was stuck: the authenticated flows (results page reading order, the taste map,
the ritual stepper's focus handoffs) can now be reached on a local server without deploying.
Driving VoiceOver or NVDA and judging what is *announced* needs a human at the keyboard — an
agent can assert that roles and names exist in the DOM, which is already done, but not that
the announcement is intelligible. Sam or another human should do that sitting in front of
this same local server.

---

## Part 2 — 1.4.10 Reflow at 320 CSS px, authenticated routes

### Method

- Server: `wrangler dev` on the OpenNext build, real D1 + secrets. Signed in as `user-a11y`.
- Viewport: 320 × 800 (the 400%-zoom equivalent of a 1280px reference), Chromium.
- Per route: compared `document.scrollingElement.scrollWidth` against `clientWidth`, then
  walked every `body *` node with `getBoundingClientRect()` flagging any `right > vw` or
  `left < 0`, capturing computed `width` / `min-width` / `white-space` / `overflow-x`.
- Additionally swept for (a) descendants with `overflow-x: auto|scroll` and
  `scrollWidth > clientWidth` — a 2-D scroll region inside the page, and (b) descendants with
  `text-overflow: ellipsis` and `scrollWidth > clientWidth` — clipped content that produces no
  scrollbar and would be invisible to a scrollWidth-only check.
- `position: fixed` nodes and visually-hidden nodes (`clip-path: inset(50%)`, or ≤2×2px) are
  excluded from the offender list and counted separately. The only such node on every route is
  the `SkipLink`, which is the standard `sr-only` pattern, not overflow.
- Screenshots were taken at several scroll offsets per route as a check on clipping and
  overlap, but every verdict below rests on the measurements, not the images. (Two screenshots
  during this run came back blank or stale while the DOM query showed correct geometry — the
  images lag, exactly as warned.)

### Per-route results

Every route: **`scrollWidth === clientWidth === 320`, zero overflowing elements, zero
horizontally-scrollable subregions.**

| Route / state | scrollHeight | Offenders | h-scroll regions | Clipped text |
|---|---|---|---|---|
| `/profile` (full editor: 77 chips across comfort/watchlist/vibes/dealbreakers/streaming) | 3946 | 0 | 0 | none |
| `/groups` (one 2-member group + create + join forms) | 1598 | 0 | 0 | **invite link, 79px hidden** |
| `/tonight` (group picker + solo card + both CTAs) | 1089 | 0 | 0 | **member list, 43px hidden** |
| `/quick` (8-chip mood picker + CTA) | 1001 | 0 | 0 | none |
| `/ritual` step 1 — own profile editor | 3525 | 0 | 0 | current step label, 28px hidden |
| `/ritual` step 2 — partner + rough-day toggle | 1051 | 0 | 0 | none visible |
| `/ritual` step 3 — **Mood, 30-chip grid** | 2710 | 0 | 0 | none visible |
| `/ritual` step 3 with 19 of 30 chips selected | 2810 | 0 | 0 | none visible |
| `/results/sess-a11y` — Taste map tab | 2258 | 0 | 0 | none |
| `/results/sess-a11y` — The picks tab | 3378 | 0 | 0 | none |
| `/results/sess-a11y` — In words tab | 1788 | 0 | 0 | none |
| `/groups/join/aB3dK9mQ` — **signed-in branch** | 820 | 0 | 0 | none |

The three surfaces flagged as the highest risk all pass cleanly:

- **The chip grid.** 30 preset chips (16 mood + 14 genre) wrap to 2–3 per row at 320px with
  no overflow. Rightmost chip edge measured **292.5px** against a 320px viewport. Selecting
  chips adds `font-medium` (400 → 500), which widens the label — re-measured with 19 of 30
  selected and the rightmost edge was unchanged at 292.5px, so the selected state has no
  reflow cost.
- **The results tablist.** All three tabs fit on one row: right edges at 89.4 / 179.7 /
  263.2px. No wrap, no scroller, no truncation.
- **The taste map.** Contains no SVG and no canvas — it is a legend, per-member prose, and
  chip rows. There is no 2-D-layout content anywhere in the app, so 1.4.10's exception clause
  never applies.

The ritual stepper deserves a note as a *correct* pattern rather than a finding: below the
`sm:` breakpoint only the current step's label is painted; the other two are `sr-only`, so a
long member name cannot force horizontal scroll while the labels stay in the accessibility
tree at every width (`src/components/progress-steps.tsx`). The probe flags them as "clipped"
only because it measures before checking visibility — they are correctly hidden.

Poster images 404 in this environment (they point at `image.tmdb.org`). This does **not**
weaken the picks-tab result: the `<img>` boxes are laid out at their full reserved
184.8 × 277.1px regardless, so the geometry measured is the real geometry. Only the pixels
inside the box are missing, and those cannot affect layout.

### Open gaps found — NOT fixed, per instruction

Two pieces of content are visible at 1280px and clipped at 320px with no way to reveal them.
Neither causes horizontal scrolling, so neither is a "scrolling in two dimensions" failure —
but 1.4.10 also requires no *loss of information*, and information is lost here.

**GAP-1 — `/groups` invite link truncated (the more serious of the two)**

- Element: `src/app/groups/page.tsx`, the invite-link display —
  `<span className="min-w-0 flex-1 truncate rounded-control border border-slate bg-midnight px-md py-sm text-sm tracking-wide text-cream">`
- At 320px: `clientWidth 236` vs `scrollWidth 315` → **79px (≈25% of the URL) clipped.**
- At 375px: still clipped, 23px hidden. At 1280px: not clipped.
- Cause: `truncate` (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) with no
  `title` attribute and no scrollable overflow.
- Why it matters more than it looks: the source comment above `copyInvite` says the clipboard
  failure path is safe *"because the link is rendered in full above the button, so it stays
  selectable by hand."* At 320px that fallback does not hold — the link is not rendered in
  full. A user on a narrow viewport whose clipboard write fails (insecure context, denied
  permission) has no way to read or transcribe their own invite link. It gets worse with a
  production origin longer than the 21-character `http://127.0.0.1:8791` used here.
- Cheapest honest fixes, in rough order of preference: `break-all` + `white-space: normal`
  below `sm:` (matching what `/groups/join/[code]` already does with the raw code, which
  measured clean); or show the bare 8-char invite code instead of the full URL at narrow
  widths; or add `title={inviteLink(...)}` as a minimum mitigation.

**GAP-2 — `/tonight` group member list truncated**

- Element: `src/components/group-picker.tsx`, the member-name line —
  `<span className="mt-2xs block truncate text-sm text-ash">`
- At 320px: **43px clipped** with the test names ("Alexandra Featherstonehaugh, Jordan").
  Not clipped at 375px or 1280px.
- Lower severity: this is descriptive context for a card the user is choosing between, not a
  unique unrecoverable value, and the group name above it is not truncated. It is only
  reachable with names long enough to overflow. Still a 320px-only content loss.
- Fix shape: allow the line to wrap to two lines at narrow widths (`line-clamp-2` rather than
  `truncate`).

**GAP-3 (marginal) — `/ritual` current-step label truncated**

- 28px clipped at 320px only, and only with an unusually long display name (27 chars). Not
  clipped at 375px. The full string is in the accessibility tree. Listed for completeness;
  arguably within tolerance for a progress indicator that is not the primary content.

### What remains unverified after this pass

- **Screen-reader / AT pass** — unchanged. Needs a human with VoiceOver or NVDA. The runbook
  above removes the environment blocker; the human is still required.
- **`/results` refinement round in flight** — the loading narrative (`PhasedLoading`) and the
  post-round error framings were not rendered, because triggering them requires a real
  Anthropic call. Their layouts are simple text blocks inside the same `max-w-[680px]` main
  as everything else measured, so the risk is low, but they were not measured.
- **Deployed-environment check** — everything here is local. Production origin lengths make
  GAP-1 worse, not better; nothing else is origin-sensitive.
- **1.4.4 Resize Text** was not separately exercised via browser text-only zoom. The 320px
  result is the conventional proxy and is what `accessibility.md` records, but the two
  criteria are not identical.

---

## Part 3 — Chip grid captures for the density call

PR #5 raised every interactive resting border from `slate` to `ash`. Confirmed live in this
build: a resting chip computes `border-color: rgb(139,149,168)` (`--ash #8b95a8`) at `1px`
on `background: rgb(26,31,46)` (`--charcoal`), label `--cream`, `font-weight: 400`. A selected
chip is `border/color: rgb(232,168,73)` (`--amber`) over `rgba(232,168,73,0.125)` at
`font-weight: 500`.

One precision note for the decision: chips sit on **charcoal**, not midnight (`Chip`'s `IDLE`
is `bg-charcoal`). The governing ratio for this grid is therefore **5.44:1**, not the 6.21:1
midnight figure — both clear the 3:1 requirement, but 5.44:1 is the number the grid actually
reads at.

Captured at `dev/reports/screenshots/`, cropped to the chip region (both groups plus their
`MOODS & TONES` / `GENRES` labels and the custom-tag row):

| File | Width | State |
|---|---|---|
| `chip-grid-375px-resting.png` | 375 | 30 chips, none selected |
| `chip-grid-375px-selected.png` | 375 | 8 selected (Cozy, Cerebral, Slow-Burn, Mind-Bending, Emotional, Sci-Fi, Drama, Mystery) |
| `chip-grid-1280px-resting.png` | 1280 | 30 chips, none selected |
| `chip-grid-1280px-selected.png` | 1280 | same 8 selected |

Captured against the ritual Mood step, which starts with an empty selection — the only
30-chip surface in the app that has a genuine resting state (`/profile`'s pickers arrive
pre-populated from the saved profile).

Two observations offered as input, not as a recommendation — **no colors were changed, this
is Sam's call**:

- The 1280px resting grid is 30 pills across 6 rows in a single unbroken block. At that width
  the pills are the loudest thing on screen because nothing else competes for the eye; at
  375px the same pills read calmer, because wrapping to 2–3 per row breaks up the repetition
  and the grid stops looking like a wall.
- The selected/resting distinction survives the change comfortably. Amber against ash still
  separates at a glance in both captures, which is the thing that would have been at risk.
  If the resting set does read too hot, the fallback already documented in
  `accessibility.md` — a dedicated mid-tone token between `slate` and `ash` — is still the
  right lever, and it would only need to move the chip's boundary, not every control's, since
  `outlinedBoundaryClasses` is one string with a test pinning its call sites.

---

## Appendix — fixture SQL

Applied with `npx wrangler d1 execute movie-night-db --local --file=…`. Local only; never
run against remote D1.

```sql
INSERT INTO users (id, google_id, email, name, avatar_url, created_at) VALUES
  ('user-a11y','google-a11y-1','alexandra.verification@example.test','Alexandra Featherstonehaugh',NULL,'2026-07-01T12:00:00.000Z'),
  ('user-partner','google-a11y-2','jordan@example.test','Jordan',NULL,'2026-07-01T12:00:00.000Z');

INSERT INTO profiles (user_id, comfort_titles, watchlist, vibes, dealbreakers, streaming_services, updated_at) VALUES
  ('user-a11y','[27205,155,680]','[157336]','["Cozy","Cerebral","Slow-Burn","Mind-Bending","Drama","Sci-Fi"]','["Horror","True Crime"]','["Netflix","Max","Criterion Channel"]','2026-07-01T12:00:00.000Z'),
  ('user-partner','[603,13]','[496243]','["Thrilling","Funny","Adventurous","Action","Superhero"]','["Musical"]','["Netflix","Disney Plus"]','2026-07-01T12:00:00.000Z');

INSERT INTO groups (id, name, invite_code, created_at) VALUES
  ('grp-a11y','Sunday Nights on the Extremely Long Couch','aB3dK9mQ','2026-07-01T12:00:00.000Z');

INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES
  ('gm-a11y-1','grp-a11y','user-a11y','2026-07-01T12:00:00.000Z'),
  ('gm-a11y-2','grp-a11y','user-partner','2026-07-01T12:00:00.000Z');

-- streaming is StreamingInfo: flatrate/rent/buy are string[] of provider names.
INSERT OR REPLACE INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path,
  vote_count, vote_average, popularity, top_cast, keywords, streaming, last_refreshed_at, created_at) VALUES
  (27205,'movie','Inception',2010,'["Action","Science Fiction","Adventure"]','A thief who steals corporate secrets through dream-sharing technology.','/inception.jpg',36000,8.4,120.5,'["Leonardo DiCaprio"]','["dream"]','{"flatrate":["Netflix","Criterion Channel"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z'),
  (155,'movie','The Dark Knight',2008,'["Drama","Action","Crime","Thriller"]','Batman raises the stakes in his war on crime.','/dark-knight.jpg',32000,8.5,110.2,'["Christian Bale"]','["superhero"]','{"flatrate":["Max"],"rent":["Apple TV"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z'),
  (680,'movie','Pulp Fiction',1994,'["Thriller","Crime"]','The lives of two mob hitmen intertwine.','/pulp.jpg',27000,8.5,95.1,'["John Travolta"]','["nonlinear"]','{"flatrate":["Netflix","Criterion Channel"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z'),
  (157336,'movie','Interstellar',2014,'["Adventure","Drama","Science Fiction"]','A team of explorers travel through a wormhole.','/interstellar.jpg',34000,8.4,130.9,'["Matthew McConaughey"]','["space"]','{"rent":["Amazon Video"],"buy":["Apple TV"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z'),
  (603,'movie','The Matrix',1999,'["Action","Science Fiction"]','A hacker learns the truth about his reality.','/matrix.jpg',25000,8.2,88.4,'["Keanu Reeves"]','["simulated reality"]','{"flatrate":["Max"],"rent":["Apple TV"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z'),
  (13,'movie','Forrest Gump',1994,'["Comedy","Drama","Romance"]','Kennedy and Johnson through the eyes of an Alabama man.','/gump.jpg',26000,8.5,76.2,'["Tom Hanks"]','["vietnam war"]','{"flatrate":["Netflix","Criterion Channel"]}','2026-07-29T12:00:00.000Z','2026-07-01T12:00:00.000Z');

INSERT INTO movie_sessions (id, group_id, initiated_by_user_id, mood_vibes, mood_text, discover_new, is_quick_match, created_at) VALUES
  ('sess-a11y','grp-a11y','user-a11y','["Cozy","Mind-Bending","Slow-Burn","Emotional"]','Something we can both sink into.',0,0,'2026-07-30T20:00:00.000Z');

INSERT INTO session_members (id, session_id, user_id, rough_day) VALUES
  ('sm-a11y-1','sess-a11y','user-a11y',0),
  ('sm-a11y-2','sess-a11y','user-partner',1);

-- ai_response is the whole MatchingResponse: tasteMap.members[], tasteMap.overlap,
-- recommendations[], conversational. Abbreviated here; use prose long enough to
-- exercise wrapping at 320px.
INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids,
  removed_tmdb_ids, steering_feedback, model, prompt_version, candidate_snapshot, created_at) VALUES
  ('rec-a11y-1','sess-a11y',1,
   '{"tasteMap":{"members":[{"userId":"user-a11y","name":"Alexandra Featherstonehaugh","summary":"Drawn to films that take their time.","primaryVibes":["Cozy","Cerebral","Slow-Burn","Mind-Bending"],"genreAffinities":["Drama","Sci-Fi","Documentary"]},{"userId":"user-partner","name":"Jordan","summary":"Wants momentum.","primaryVibes":["Thrilling","Funny","Adventurous"],"genreAffinities":["Action","Superhero","Comedy"]}],"overlap":{"summary":"The disagreement is about tempo, not intelligence.","sharedVibes":["Mind-Bending","Emotional"],"tensionPoints":["Pacing","Ambiguous endings","Runtime past two hours"]}},"recommendations":[{"tmdbId":27205,"matchScore":94,"explanation":"A heist film wearing a philosophy seminar as a disguise."},{"tmdbId":157336,"matchScore":88,"explanation":"The quiet stretches are earned by the set pieces around them."},{"tmdbId":603,"matchScore":85,"explanation":"High concept delivered at speed."},{"tmdbId":155,"matchScore":79,"explanation":"Superhero on the surface, moral pressure cooker underneath."},{"tmdbId":680,"matchScore":71,"explanation":"Structurally playful and endlessly quotable."}],"conversational":"You two are not as far apart as the profiles suggest."}',
   '[]','[]','','claude-sonnet-4-6','v1','[27205,157336,603,155,680,13]','2026-07-30T20:01:00.000Z');
```
