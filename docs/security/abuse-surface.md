# Abuse surface

What every API route costs us per request, what repeating it buys an attacker, and what
bounds it. Written before the app was shared with anyone, so nothing here is a migration of
live behaviour — the numbers are policy, chosen now, and cheap to change.

The governing observation: **a per-request ceiling multiplied by unlimited requests bounds
nothing.** `MAX_UNKNOWN_IDS_PER_PUT` (50 TMDB fetches per save), `MAX_ROUNDS_PER_SESSION`
(10 rounds per session) and `MAX_RESOLVED_IDS` (100 ids per lookup) are all per-request
ceilings. Before this pass, exactly one route in the app limited *requests*: group join.

Every limit lives in `RATE_LIMITS` in `src/lib/rate-limit.ts`, backed by the `rate_limit_log`
table. `src/lib/rate-limit.test.ts` pins the numbers, so changing one fails a test first.

---

## Per-route exposure

Ranked within each tier by real exposure for an app about to be shared with a handful of
people. "Theoretical" means the attack works but nobody plausibly runs it at this scale.

### Tier 1 — spends money or third-party quota

| Route | Auth | Cost of one request | What repeating it buys | Bound now |
|---|---|---|---|---|
| `POST /api/movie-sessions/[id]/match` | yes | **1–4 Claude Sonnet calls** (2 attempts × `maxRetries: 1`), ~$0.04 typical / ~$0.16 worst case, plus 10 D1 round trips | Drains the shared spend budget. `MONTHLY_MATCH_LIMIT` (2000) is **global**, so one account could burn everyone's allowance in an afternoon; the 10-round session cap was defeated by creating another free session | `RATE_LIMITS.match` — 30 / 24h per user, plus the pre-existing global monthly cap |
| `PUT /api/user/profile` | yes | Up to **50 sequential TMDB detail fetches** + 50 D1 writes; measured ~4.2s even when every fetch fails instantly | Burns TMDB quota against our credentials and holds a Worker open for seconds at a time | `RATE_LIMITS.profileSave` — 20 / 10min per user |
| `GET /api/titles/search?q=` | yes | 1 unindexed `LIKE '%…%'` scan of `titles`, **+1 TMDB search** whenever fewer than 3 local rows match | Free anonymous TMDB proxy on our API token; a partial query almost always falls through to TMDB | `RATE_LIMITS.titleSearch` — 120 / 10min per user, metered **only on the TMDB half** |

### Tier 2 — writes unbounded rows to D1

| Route | Auth | Cost of one request | What repeating it buys | Bound now |
|---|---|---|---|---|
| `POST /api/movie-sessions` | yes | A batched insert of the session + one `session_members` row per group member | Unbounded `movie_sessions` / `session_members` growth. Was the loophole that made `MAX_ROUNDS_PER_SESSION` decorative; the per-user match cap now closes the *spend* half | nothing — see [Deliberately unbounded](#deliberately-unbounded) |
| `POST /api/groups` | yes | 2 writes in one batch + a member read | Unbounded `groups` rows, and each one enlarges that same user's `GET /api/groups` fan-out (one read per group, N+1) | nothing — see below |
| `POST /api/groups/join` | yes | 1 count, 1 insert, 1 prune, 1 group lookup, 1 conditional insert | Invite-code enumeration (8 chars from a 54-symbol alphabet ≈ 7.2 × 10¹³, so guessing is hopeless at any rate) | `RATE_LIMITS.groupJoin` — 10 / 10min per user (pre-existing) |
| `POST /api/groups/[id]/leave` | yes | 1 read + 1 delete | Nothing — self-scoped and idempotent | nothing (correctly) |
| `DELETE /api/user/account` | yes | One batch of anonymising writes | Nothing after the first call. Note the JWT is stateless: a deleted user's session cookie keeps authenticating for up to 15 minutes, so the handler can run again against an already-deleted user | nothing (correctly) |

### Tier 3 — reads only

| Route | Auth | Cost of one request | Notes |
|---|---|---|---|
| `GET /api/movie-sessions/[id]` | yes | Session read + latest recommendation + a titles hydration bounded by that round's pick count | Cheap and bounded. |
| `GET /api/groups` | yes | 1 read + **one read per group the caller belongs to** | The N+1 is bounded only by the caller's own group count, which `POST /api/groups` leaves unbounded. Self-inflicted, so it degrades the attacker first. |
| `GET /api/groups/[id]` | yes | 3 indexed reads | Non-members and unknown ids both 404, so existence never leaks. |
| `GET /api/user/profile` | yes | 1 indexed read | |
| `GET /api/auth/me` | yes | 1 indexed read | |
| `GET /api/titles/search?ids=` | yes | ≤2 chunked `IN (…)` reads (ids capped at 100, chunked at 90 per PLAT-1) | |
| `GET /api/titles/search?popular=` | yes | 1 indexed read, `LIMIT 12` | |

### Tier 4 — unauthenticated

| Route | Cost of one request | What repeating it buys | Bound now |
|---|---|---|---|
| `GET /api/auth/google/callback` | With a matching state cookie: **one outbound HTTPS token exchange to Google**. Only on a genuine, unused Google auth code does it reach D1 (upsert + session insert + count + trim) | Forces one outbound subrequest per hit. The attacker must first call `/api/auth/google` to obtain a state/verifier pair, but that is free and the pair is reusable for its 600s cookie lifetime — the callback clears those cookies on success and on user-cancel, **not** on a state mismatch or a failed code exchange. No account can be created without a real Google code | nothing |
| `GET /api/auth/google` | Two cookie writes and an arctic URL build. No D1, no network | State/verifier pairs on demand, which is the precondition above | nothing |
| `POST /api/auth/logout` | 1 SHA-256 + 1 indexed D1 read on an attacker-chosen token hash; a 2-statement batch only on a real hit | One indexed read per request | nothing |
| *every authenticated route* | `authenticateRequest` costs **zero D1 reads** on the fast path (valid 15-minute session JWT). With no session cookie but an arbitrary `mn-refresh` cookie, it costs 1 SHA-256 + 1 indexed read before returning 401 | An unauthenticated caller can force one D1 read on any route by sending a junk refresh cookie | nothing |

**On OAuth state/PKCE replay:** state is compared against a cookie this server set, and the
PKCE verifier is bound to the code exchange by Google. Replaying a *used* auth code fails at
Google. The residual issue is login-CSRF — an attacker planting their own state+verifier in
a victim's browser so the victim silently signs in as the attacker — which `httpOnly` +
`SameSite=Lax` makes impractical, and which we have no cross-account data flow to exploit
anyway. Theoretical at this scale; the concrete gap is only that a failed exchange leaves the
state cookie live for the rest of its 600 seconds.

---

## Limits added

All four rules are per-user (the authenticated user id), counted in `rate_limit_log`, checked
by `withinRateLimit` and recorded by `recordRateLimitHit`.

| Rule | Scope | Limit | Why this number |
|---|---|---|---|
| `match` | `match` | 30 / 24h | Two full 10-round evenings plus half again for error retries — beyond any real evening's use. Caps one account at ~$1.20/day typical and ~$4.80 worst case, and makes draining the 2000-call monthly budget take a single actor 67 days instead of one afternoon. |
| `profileSave` | `profile_save` | 20 / 10min | Saving is an explicit button press; 20 per ten minutes is one save every 30 seconds sustained, far above any editing rhythm. Holds one account's novel-id enrichment under 100 TMDB fetches a minute. Repeat saves of the same titles cost nothing — enrichment is a cache fill. |
| `titleSearch` | `title_search` | 120 / 10min | The picker debounces at 250ms and a person spends ~5 debounced requests per title looked up, so 120 covers ~24 titles searched in a ten-minute stretch — one every 25 seconds, sustained, which nobody types for ten minutes straight. A script sitting on the debounce floor (4 req/s) crosses it in 30 seconds. Ten users all at the ceiling draw 2 TMDB req/s, well inside TMDB's ~50/s guidance. |
| `groupJoin` | `group_join` | 10 / 10min | Pre-existing, unchanged. Moved verbatim out of `src/lib/groups.ts` onto the shared limiter. |

### Behaviour when a limit trips

- **Match** — `429` with `kind: "daily_limit"`, and the results page frames it as
  "That's today's last round" with `retry: false`. The other 429 kinds offer a retry button;
  this window is a day, so offering one would be a lie.
- **Profile save** — `429`. Nothing is written and no TMDB fetch is made.
- **Title search** — **no error.** The route drops the TMDB fallback and returns local
  results only, the same degraded shape it already serves during a TMDB outage. A typeahead
  that starts erroring mid-word is a worse answer than a shorter list.

### Two deliberate properties

**Spend is recorded before the model call, not after.** A match round is billed the moment we
ask Anthropic, whether or not the answer comes back usable, so a failed round still consumes
one of the caller's 30. Pinned by a test.

**Only the TMDB half of title search is metered.** A local-catalog hit spends nothing outside
D1, so it neither counts toward the limit nor pays the limiter's own three round trips. This
is the general rule the other limits follow too: meter the thing you are protecting.

### What the limiter costs

Each limited request adds three D1 round trips: the count, the insert, and the prune. On the
match route that is noise against a multi-second model call (the round-trip budget test moved
from 7 to 10 and the reason is written into the test). On the profile PUT it is noise against
up to 50 sequential TMDB fetches. On title search it is only paid by requests that were about
to make an outbound HTTPS call anyway.

The count could be folded into `getMatchRoundContext`'s existing `db.batch()` to get the
match route back to 8 round trips. That requires editing `src/lib/movie-sessions.ts`, which
was owned by another agent during this pass — noted, not done.

### `rate_limit_log` growth

Every rule is keyed on a user id, so the key space is bounded by the user table. Worst case
per user is 10 + 30 + 20 + 120 = **180 rows**, and `recordRateLimitHit` prunes that
(scope, key)'s out-of-window rows on every write. There is no sweeper and none is needed.

This is the specific reason no limit here is keyed on IP. An IP-keyed rule inverts the
property: keys become attacker-chosen and unbounded, and because pruning only happens when a
key is written *again*, rows from a one-shot IP are never collected. Adding IP keying means
adding a sweeper (a cron pass over `rate_limit_log`) first — otherwise the limiter becomes
the amplification vector it was meant to stop.

---

## Deliberately unbounded

**`POST /api/movie-sessions` and `POST /api/groups`.** Neither spends money or third-party
quota; each is a couple of D1 writes. The reason session creation *looked* urgent is that it
reset the 10-round session cap — and the per-user match limit now bounds spend regardless of
how many sessions exist, so the loophole is closed at the place the money is. What remains is
generic D1 row flooding by an authenticated user, which is one shared class covering both
routes plus `session_members`, and which nothing addresses today. Ranked medium-theoretical:
it needs a signed-in Google account and produces no leverage beyond storage cost.

**Everything in Tier 3.** Single indexed reads. Limiting them would cost more D1 round trips
than it saves.

**`POST /api/auth/logout`, `GET /api/auth/google`, the OAuth callback, and the junk-refresh-
cookie read.** All unauthenticated, so the only available key is the IP — see the growth note
above. Cloudflare sits in front of all of them; the platform's own DDoS and rate-limiting
rules are the right layer for unauthenticated traffic, not a D1 table.

**`GET /api/titles/search`'s local `LIKE '%…%'` scan.** A leading wildcard cannot use an
index, so this is a full scan of `titles` on every query. At ~1,000 rows that is microseconds.
Worth revisiting if the catalog grows by an order of magnitude, or if the route ever stops
requiring auth.

---

## Needs Sam's decision

1. **A per-user *monthly* spend cap.** The daily cap lets one account reach ~900 matches a
   month, ~45% of the 2000 global allowance. With more than two active accounts the global
   cap is what bites, and it bites everyone at once, first-come-first-served. A per-user
   monthly share would make exhaustion fair instead of racy — but that is a product call
   about what a single household is entitled to, not an engineering one.

2. **Are the four numbers right?** They are set well above believable human behaviour on
   purpose, so they should never fire for a real user. If you would rather they bite sooner
   (cheaper worst case, occasional false positive) or later, they are single-line edits in
   `RATE_LIMITS` with a matching edit to `rate-limit.test.ts`.

3. **Turn `MONTHLY_MATCH_LIMIT` down before sharing.** 2000 Sonnet calls is ~$80/month at the
   typical per-round cost and ~$320 worst case. For a handful of friends, a couple of hundred
   is plenty, and the variable already works as a kill switch (`0` disables matching).

4. **Cloudflare-layer rate limiting for the unauthenticated routes.** The OAuth callback,
   `/api/auth/google` and logout are best limited by IP at the edge, where the key space is
   the platform's problem rather than a D1 table's. This is a dashboard/wrangler
   configuration decision, not a code change.

5. **D1 row flooding by an authenticated user** (session and group creation). Options: cap
   rows per user, add rate limits to both routes for symmetry, or accept it and watch. At
   invite-only scale, "accept and watch" is defensible; it stops being defensible the moment
   sign-up is open.
