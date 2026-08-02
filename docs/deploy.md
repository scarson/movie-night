# Deploying Movie Night to Cloudflare

Target: `movienight.scarson.io` on Cloudflare Workers via OpenNext.

This document exists because Phase 8 could not run the deployment itself — the
build environment had no TMDB token, no Anthropic API key, and no Google OAuth
client. Everything below is written to be executed in order by someone holding
those credentials. Steps 1–6 are one-time setup; steps 7–8 are every subsequent
deploy.

## Prerequisites

| Credential | Used for | Where to get it |
|---|---|---|
| Cloudflare account | Workers, D1 | `npx wrangler login` (already authenticated as samuel.carson@gmail.com) |
| TMDB API read token (v4 bearer) | Catalog seed + weekly refresh | themoviedb.org → Settings → API |
| Anthropic API key | The matching engine | console.anthropic.com |
| Google OAuth client ID + secret | Sign-in | Google Cloud Console → APIs & Services → Credentials |
| JWT signing secret | Session cookies | Generate: `openssl rand -base64 32` |

## 1. Create the D1 database — ✅ DONE

`movie-night-db` is provisioned in region ENAM as
`46d47bab-95d7-4bfa-9923-e51b72fc15f1`, and `wrangler.jsonc` already points at
it. Nothing to do here unless you are standing up a second environment, in which
case: `npx wrangler d1 create <name>` and copy the returned id into the config.

## 2. Apply the schema — `0001` ✅ DONE

`migrations/` holds more than one file, and the ✅ covers
`0001_initial_schema.sql` only — see **Pending migrations** below for the rest.
`0001` has been applied to the remote database (13 tables). Re-running it is
only needed for a fresh database:

```bash
npx wrangler d1 execute movie-night-db --remote --file=migrations/0001_initial_schema.sql
```

Verify:

```bash
npx wrangler d1 execute movie-night-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expect 13 tables: `group_members`, `groups`, `movie_sessions`, `profiles`,
`rate_limit_log`, `recommendations`, `session_members`, `sessions`,
`tension_axes`, `titles`, `users`, `watch_history`, `watch_ratings`. The last
three are Phase 2 tables, created empty by design.

### Pending migrations — not yet applied to the remote database

Section 2 is marked DONE for `0001` only. Everything listed here still has to be
applied by hand, in numeric order, before the deploy that depends on it.

**The checkboxes below are notes, not the mechanism.** `npm run preflight --
--remote` reads the DDL out of `migrations/` and compares it against the target
database's `sqlite_master`, so it reports what is genuinely unapplied and prints
the command for each. Trust it over this list. Add prose here to explain *why* a
migration matters; the preflight covers a new file the moment it lands in
`migrations/`, with nothing to remember to update.

Measured against the remote database on 2026-08-01, the preflight reports `0002`,
`0003` and `0004` unapplied and `titles` empty — which agrees with the checkboxes
below.

- [ ] `0002_session_rotated_at.sql` — adds `sessions.rotated_at`, the single-winner
      mark for refresh-token rotation. Without the column every token refresh
      throws, and `authenticateRequest` runs before each route's own error
      handling, so signed-in users get a raw 500 rather than a sign-in prompt.
      Nullable `ALTER TABLE … ADD COLUMN`: re-applying it fails on `duplicate
      column name` and changes nothing.

```bash
npx wrangler d1 execute movie-night-db --remote --file=migrations/0002_session_rotated_at.sql
```

- [ ] `0003_title_refresh_attempt.sql` — adds `titles.last_refresh_attempt_at`
      and backfills it from `last_refreshed_at`. The weekly refresh selects
      candidates on this column; until it is applied the cron's `SELECT` fails
      on every run and no title is refreshed.

```bash
npx wrangler d1 execute movie-night-db --remote --file=migrations/0003_title_refresh_attempt.sql
```

Verify afterwards — the two counts must match:

```bash
npx wrangler d1 execute movie-night-db --remote --command="SELECT COUNT(*) AS total, COUNT(last_refresh_attempt_at) AS backfilled FROM titles"
```

- [ ] `0004_recommendation_indexes.sql`

```bash
npx wrangler d1 execute movie-night-db --remote --file=migrations/0004_recommendation_indexes.sql
```

`0004` is index-only and every statement is `IF [NOT] EXISTS`, so re-applying it
is a no-op. Its two `DROP INDEX`es are irreversible; to roll them back:

```sql
CREATE INDEX idx_recommendations_session ON recommendations(session_id);
CREATE INDEX idx_movie_sessions_group ON movie_sessions(group_id);
```

### The local database

`npm run migrate:local` applies every file in `migrations/` in filename order,
and stops at the first one that fails. A local D1 built with it carries every
migration above, so no later file needs applying by hand.

**It targets a FRESH local database.** Against a local D1 that already has
`0001` applied, the very first file fails on `table users already exists` and
nothing after it runs — so a newly added migration silently never lands. The
script is deliberately strict about this rather than skipping files that error,
because a tolerant loop is how a genuinely malformed migration goes unnoticed.

To reset and reapply from scratch:

```bash
rm -rf .wrangler/state/v3/d1
npm run migrate:local
npm run seed:local
```

## 3. Configure the Google OAuth client

In Google Cloud Console, create an OAuth 2.0 Web application client and add
these **Authorized redirect URIs**:

- `https://movienight.scarson.io/api/auth/google/callback` — production
- `http://localhost:8787/api/auth/google/callback` — local `npm run preview`

The callback path is fixed by `src/app/api/auth/google/callback/route.ts`. A
mismatch here surfaces as Google's `redirect_uri_mismatch` error, not as an app
error.

## 4. Set the secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TMDB_API_TOKEN
```

Optional: `MONTHLY_MATCH_LIMIT` (defaults are in `src/lib/matching.ts`) caps
Anthropic spend by rejecting matches past a monthly count.

For local preview, create `.dev.vars` (gitignored) with the same keys as
`KEY=value` lines.

## 5. Seed the catalog

Requires `TMDB_API_TOKEN` in the environment or `.dev.vars`.

```bash
npm run seed:local -- --pages 25          # local D1, ~500 titles
npx tsx scripts/seed.ts --remote --pages 25   # production D1
```

The script writes `scripts/seed.sql` (gitignored) then applies it via wrangler.
It aborts with a clear message rather than applying an empty file if TMDB
returns no titles. Re-running is safe — inserts are upserts keyed on
`(tmdb_id, content_type)`.

**The app is not usable before this step.** With an empty `titles` table the
matching engine has no candidates and every match returns thin results.

## 6. Custom domain

Add `movienight.scarson.io` as a custom domain on the Worker (Cloudflare
dashboard → Workers & Pages → movie-night → Settings → Domains & Routes).
Cloudflare provisions the certificate. Do this before the first real sign-in so
the OAuth redirect URI matches from the start.

## 7. Preflight

```bash
npm run preflight -- --remote     # or --local, for a wrangler dev run
```

Five checks, each printing what to run when it fails. Exits non-zero if any
fails, so it can gate a script. It reads secret **names** only and never a value.

| Check | What it reads |
|---|---|
| `DB` binding configured | `d1_databases` in `wrangler.jsonc`, including a non-empty `database_id` |
| cron trigger registered | `triggers.crons` matches the weekly schedule the refresh is sized for, and `worker.ts` still exports `scheduled` |
| secrets set | `wrangler secret list` (remote) or the keys in `.dev.vars` plus the environment (local) |
| migrations applied | every table, column and index the DDL in `migrations/` declares, against `sqlite_master` — including indexes a migration *drops*, which is how an unapplied `0004` is visible at all |
| titles catalog non-empty | `SELECT COUNT(*) FROM titles` |

The migration check is the one that earns its keep. It parses the DDL rather
than tracking applied files, so it needs no ledger table and cannot drift from
the migration set: add `0005_*.sql` and it is checked on the next run. It reads
columns out of `sqlite_master.sql` — SQLite rewrites that text in place on
`ALTER TABLE … ADD COLUMN` — because D1 refuses `pragma_table_info` across every
table in one statement with `not authorized: SQLITE_AUTH`.

The cron check is against the config, deliberately: `wrangler deploy` replaces
the Worker's triggers with whatever `triggers.crons` holds
([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)),
so the config is what registers the trigger. Confirm it landed afterwards — see
§Post-deploy verification step 2.

## 8. Deploy

```bash
npm run deploy    # opennextjs-cloudflare build && wrangler deploy
```

CI (`.github/workflows/ci.yml`) runs type-check, lint, test, and build on pushes
to `dev` and `main`; deployment is manual via this command.

**Record the "Worker Startup Time" wrangler prints** in
`dev/reports/2026-08-01-performance-audit.md` §4.1. It is the cold-start baseline
that audit could not measure, and a 5.1 MiB script is parsed against a 400 ms
startup-CPU limit.

## Plan tier — ✅ Workers Paid

**Workers Paid is a prerequisite for this application, and this account is on it**
(confirmed by Sam, 2026-08-01). Nothing below is a blocker for our deployment;
it is recorded so the requirement survives a change of account, a second
environment, or anyone reading `STALE_TITLES_LIMIT` and wondering whether it is
a tuning knob. It is not — leave it at 200.

`wrangler.jsonc` registers a weekly cron (`0 9 * * 1`) that refreshes streaming
availability for `STALE_TITLES_LIMIT` (200) titles per run.

| Limit | Workers Free | Workers Paid |
|---|---|---|
| External subrequests per invocation | 50 | 10,000 |
| Subrequests to Cloudflare services (D1) | 1,000 | matches the configured limit |
| CPU time per cron invocation | 10 ms | 15 min (weekly interval ≥ 1 hour) |

A 200-title run issues 200 external TMDB fetches — `fetchMovieDetail` folds
keywords, credits and watch/providers into one request via `append_to_response`
— plus 1 + `ceil(200/25)` = 9 internal D1 calls. On Free those 9 draw on the
separate Cloudflare-services budget and never compete with the fetches; on Paid
all 209 share the single 10,000 allowance, which is equally untroubled.

Subrequests are therefore not the Free-plan blocker; **CPU is**. Parsing 200
TMDB detail documents does not fit in 10 ms, and neither does an OpenNext SSR
render on the HTTP side. Lowering `STALE_TITLES_LIMIT` does not make the app
viable on Free, and at 40/week a ~1,000-title catalog takes 25 weeks to sweep,
so `asOfNote` would stamp most picks stale indefinitely. Leave it at 200 and
deploy on Paid.

The one figure worth re-checking rather than trusting: Workers Paid allowed only
1,000 subrequests per invocation until 2026-02-11. Two independent reviews of
this code reasoned from that stale number and reached opposite conclusions about
`STALE_TITLES_LIMIT`. Read the limits from the Cloudflare docs before acting on
them, as `CLAUDE.md` requires.

## Observability

**Workers Logs and tracing are already enabled** in `wrangler.jsonc` —
`observability.enabled`, `logs.invocation_logs`, `head_sampling_rate: 1` and
`traces.enabled`. Nothing to turn on. Logs are retained 7 days, a log line is
capped at 256 KB, and tracing is free during its beta
([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Traces](https://developers.cloudflare.com/workers/observability/traces/)).
`invocation_logs` is what publishes CPU and wall time per invocation, which is
why no event below carries its own duration.

### The convention

`src/lib/log.ts` exports one function. Use it for anything an operator would
need in production:

```ts
import { logEvent } from "@/lib/log";

logEvent("cron_refresh", { refreshed, fetch_errors: fetchErrors });
logEvent("provider_auth_failed", { status: err.status }, console.error);
```

- **One line of JSON, `event` first.** Stable event names — an event name is an
  interface, so rename one only as deliberately as you would rename a route.
- **Flat scalar fields only.** The `LogValue` type refuses objects, so a whole
  user row or header set cannot reach a log by accident.
- **`undefined` fields are dropped**, so an absent value costs nothing.
- **Never log a token, an auth session id or token hash, an API key, or a
  user's email.** User ids are fine; personal names are not — the taste map and
  the conversational write-up carry both, so never log a response body.
  `logEvent` replaces the value of any field whose *name* contains `token`,
  `secret`, `password`, `credential`, `api_key`, `apikey`, `authorization`,
  `cookie`, `jwt` or `email` with `[redacted]`. That catches naming, not
  content: a field called `message` will still print whatever you put in it.
- **Pass `console.error` as the third argument** for operator-actionable
  conditions; Workers Logs records the level.
- `session_id` in these events is a *movie session* id, not an auth session.

### Event catalogue

| Event | Emitted by | Fields | What its presence proves |
|---|---|---|---|
| `matching_call` | `src/lib/matching.ts` | `group_id`, `session_id`, `round`, `member_count`, `candidate_count`, `model`, `prompt_version`, `latency_ms`, `tokens_in`, `tokens_out`, `response_valid`, `dropped_ids` | One completed Anthropic call. This is the line that costs money — count it to reconcile spend. |
| `provider_auth_failed` | `src/lib/matching.ts` | `status` | A 401/403 from Anthropic. Its **absence** is positive evidence that no outbound provider call was made — the technique `dev/reports/2026-08-01-e2e-smoke-verification.md` used to prove the cost kill-switch closes before the network. |
| `removed_ids_filtered` | `src/app/api/movie-sessions/[id]/match/route.ts` | `session_id`, `submitted`, `accepted` | A client sent ids this session never recommended. |
| `round_persist_failed` | same route | `session_id`, `round`, `tmdb_ids`, `prompt_version`, `message` | A round was paid for and not stored. Enough to re-run it, no more. |
| `corrupt_ai_response` | `src/app/api/movie-sessions/[id]/route.ts` | `session_id`, `round` | A stored round failed validation and the page degraded instead of crashing. |
| `scrub_unparseable_round`, `scrub_name_shared_with_member` | `src/lib/account.ts` | `recommendationId` | Account deletion scrubbing decisions. |
| `cron_started` | `src/lib/cron-handler.ts` | `cron`, `scheduled_time` | The schedule fired. With no following `cron_refresh` or `cron_failed`, the run died mid-flight — that is the only way to tell it apart from a trigger that was never registered. |
| `cron_refresh` | `src/lib/cron-handler.ts` | `refreshed`, `fetch_errors`, `write_errors`, `failed_tmdb_ids` (up to 10, omitted when clean) | The weekly run completed. The named ids separate "these titles are gone upstream" from "TMDB is down". |
| `cron_failed` | `src/lib/cron-handler.ts` | `cron`, `scheduled_time`, `message` | The run threw and was rethrown, so Cloudflare's cron metrics record it as failed. |

Watch them live:

```bash
npx wrangler tail --format json | grep -E 'matching_call|cron_|provider_auth_failed'
```

### Converted, and not yet converted

`logEvent` is used by `src/lib/cron-handler.ts` (`cron_started`, `cron_refresh`,
`cron_failed`) and reached from `worker.ts`. **Every other event above still
builds its line with `JSON.stringify` by hand.** They already follow the shape,
so nothing is broken — but they do not get the redaction guard or the field-type
restriction. A follow-up should convert exactly these call sites:

| File | Line | Event |
|---|---|---|
| `src/lib/matching.ts` | ~538 | `provider_auth_failed` |
| `src/lib/matching.ts` | ~616 | `matching_call` |
| `src/app/api/movie-sessions/[id]/match/route.ts` | ~149 | `removed_ids_filtered` |
| `src/app/api/movie-sessions/[id]/match/route.ts` | ~216 | `round_persist_failed` |
| `src/app/api/movie-sessions/[id]/route.ts` | ~49 | `corrupt_ai_response` |
| `src/lib/account.ts` | 65, 90 | `scrub_*` (also: rename `recommendationId` to `recommendation_id` for consistency) |

Auth failures are the one gap worth naming. Every route's `catch` currently ends
in an unstructured `console.error("GET /api/…:", err)`, and
`src/app/api/auth/google/callback/route.ts` logs its three failure branches
(`exchangeErr`, `tokenErr`, D1) the same way. A failed sign-in in production is
therefore a prose line with no event name to filter on. Converting those to
`logEvent("auth_failed", { stage, user_id })` — **stage and user id only, never
the email, the OAuth code, or the id token** — is the highest-value remaining
conversion. It was left undone here because those files were owned by other
work in flight.

## Post-deploy verification

Start with the automated pass, then walk the signed-in steps in order. Each step
states what you should observe; if you do not observe it, stop rather than
continuing to the next.

```bash
npm run smoke                              # defaults to https://movienight.scarson.io
npm run smoke -- http://127.0.0.1:8787     # or any other origin
```

It checks three things and exits non-zero on any failure:

1. **`GET /` returns 200 and HTML.** A 500 here means watch `npx wrangler tail`
   and reload.
2. **`GET /api/auth/me` with no cookie returns `401 {"error":"Unauthorized"}`.**
   A 200 means the gate is open — do not share the URL. A 500 is what a schema
   behind the code looks like from outside, because `authenticateRequest` runs
   ahead of each route's own error handling; run the preflight.
3. **A content-hashed `/_next/static/*` asset, discovered from the HTML the site
   just served, carries `Cache-Control: … immutable`.** Record the value it
   prints. `public/_headers` sets this, and the `max-age=0, must-revalidate` it
   corrects has only ever been observed under `wrangler dev` — if production was
   already sending `immutable` beforehand, the finding evaporates and the file
   can be removed. Note which it was, here.

Then, by hand:

1. **`/` in a browser, signed out.** The landing page renders; the console is
   clean.
2. **The cron trigger is live.** Cloudflare dashboard → the Worker → Triggers
   shows `0 9 * * 1`. Trigger changes take up to 15 minutes to propagate. There
   is no way to force a scheduled run in production; the first real evidence is
   a `cron_started` line the following Monday, so put a note in the calendar to
   check for it. (Locally, `npx wrangler dev --test-scheduled` plus
   `curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+9+*+*+1"`
   exercises the same handler — verified working on 2026-08-01.)
3. **Sign in with Google.** Lands on `/tonight`. A `redirect_uri_mismatch` here
   is Google's error, not the app's — recheck step 3's redirect URIs.
4. **`/profile` → search a title, save.** The search dropdown returns results
   (this is the first real TMDB call) and the save round-trips: reload and the
   title is still there.
5. **`/quick` → run a match.** The first real Anthropic call. In
   `npx wrangler tail`, expect exactly one `matching_call` with
   `response_valid: true` and no `provider_auth_failed`. Note `latency_ms`,
   `tokens_in` and `tokens_out` — no measurement of any of the three exists yet
   (`dev/reports/2026-08-01-performance-audit.md` §1.4), and they dominate both
   the latency profile and the cost model.
6. **One refinement round on the results page.** The round counter advances, the
   removed titles do not come back, and a second `matching_call` appears with
   `round: 2`. If you removed a title the round never recommended you will also
   see `removed_ids_filtered`; that is correct behaviour, not a fault.
7. **Two-person match.** Create a group, open the invite link in a second
   browser with a second Google account, join, run a match. The taste map names
   both people, and `matching_call` reports `member_count: 2`.
8. **Sign out.** Cookies are cleared and `/api/auth/me` returns 401 again.

## Known deferrals

- **Live evals** (`RUN_LIVE_EVALS=1 npm test -- src/lib/matching.eval.test.ts`)
  have never been run — they need a real Anthropic key. Run them before trusting
  matching quality.
- **The adversarial prompt-injection pass** (design doc §AI Security, a stated
  launch gate) is unexecuted for the same reason. Run it against the deployed
  matching endpoint before sharing the URL publicly.
- **A screen-reader pass has never been run.** The project targets WCAG 2.2 AA
  (`docs/accessibility.md`); all ARIA work so far was verified structurally in
  the DOM, never by listening to VoiceOver/NVDA announce a flow. The deployed
  app is the right place to do it — especially the results page, whose meaning
  depends on reading order. It needs a signed-in session, which is why it is
  still open while the rest of the AA queue is closed.
- **400% zoom (1.4.10 Reflow) is untested**, as is a full sweep of the taste-map
  person colors across every surface they land on. Neither needs credentials —
  see `docs/accessibility.md` §Not yet verified.
