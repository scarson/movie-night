# Deploying Movie Night to Cloudflare

Target: `movienight.scarson.io` on Cloudflare Workers via OpenNext.

This document exists because Phase 8 could not run the deployment itself — the
build environment had no TMDB token, no Anthropic API key, and no Google OAuth
client. Everything below is written to be executed in order by someone holding
those credentials. Steps 1–6 are one-time setup; step 7 is every subsequent deploy.

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

## 2. Apply the schema — ✅ DONE

The migration has been applied to the remote database (13 tables). Re-running is
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

## 7. Deploy

```bash
npm run deploy    # opennextjs-cloudflare build && wrangler deploy
```

CI (`.github/workflows/ci.yml`) runs type-check, lint, test, and build on pushes
to `dev` and `main`; deployment is manual via this command.

## Plan-tier check before the first cron run

`wrangler.jsonc` registers a weekly cron (`0 9 * * 1`) that refreshes streaming
availability. `STALE_TITLES_LIMIT` in `src/lib/cron-handler.ts` is **200**,
which assumes the **Workers Paid** plan's CPU limits. On the Free plan the
trigger will exceed its budget and fail every run — drop the constant to ~40
before deploying on Free.

## Post-deploy verification

Run these against the live site in order; each depends on the previous:

1. `/` renders the landing page signed-out, no console errors.
2. Sign in with Google → lands on `/tonight`.
3. `/profile` → search a title (exercises TMDB + the seeded catalog), save.
4. `/quick` → run a match. This is the first real Anthropic call — watch
   `npx wrangler tail` for the `matching_call` structured log line and confirm
   `response_valid: true`.
5. On the results page, run one refinement round; confirm the round counter
   advances and removed titles do not return.
6. Create a group, open the invite link in a second browser with a second Google
   account, join, then run a two-person match and confirm the taste map names
   both people.

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
  depends on reading order. That doc also lists three open AA gaps that are
  fixable without any credentials.
