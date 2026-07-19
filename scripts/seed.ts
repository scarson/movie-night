// ABOUTME: TMDB catalog seed script — fetches discover pages + per-title detail
// ABOUTME: enrichment, emits scripts/seed.sql, and optionally applies it via wrangler.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  TmdbError,
  detailToEnrichment,
  discoverPageToTitles,
  fetchDiscoverPage,
  fetchGenreMap,
  fetchMovieDetail,
  type GenreMap,
  type TitleEnrichment,
  type TitleFields,
} from "../src/lib/tmdb";
import { parseDevVars, titleToInsertStatement } from "./seed-lib";

const DEFAULT_PAGES = 50;
const THROTTLE_MS = 50;
const PROGRESS_INTERVAL = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseArgs(argv: string[]): { pages: number; local: boolean; remote: boolean } {
  let pages = DEFAULT_PAGES;
  let local = false;
  let remote = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pages") {
      const parsed = argv[i + 1] ? Number.parseInt(argv[i + 1], 10) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) pages = parsed;
      i++;
    } else if (argv[i] === "--local") {
      local = true;
    } else if (argv[i] === "--remote") {
      remote = true;
    }
  }

  return { pages, local, remote };
}

/** Resolves TMDB_API_TOKEN from process.env, falling back to a `.dev.vars` KEY=VALUE parse (tsx does not load .dev.vars automatically, unlike Wrangler). Aborts with a clear message if neither source has it. */
function resolveToken(): string {
  if (process.env.TMDB_API_TOKEN) return process.env.TMDB_API_TOKEN;

  const devVarsPath = resolve(process.cwd(), ".dev.vars");
  if (existsSync(devVarsPath)) {
    const vars = parseDevVars(readFileSync(devVarsPath, "utf-8"));
    if (vars.TMDB_API_TOKEN) return vars.TMDB_API_TOKEN;
  }

  console.error(
    "TMDB_API_TOKEN not found. Set it in the environment or add TMDB_API_TOKEN=<token> to .dev.vars before running the seed script."
  );
  process.exit(1);
}

/** Aborts the whole run on a bad token — retrying per-title on a 401 would just burn the rate limit for no benefit. */
function abortOn401(err: unknown): void {
  if (err instanceof TmdbError && err.status === 401) {
    console.error("TMDB rejected the API token (401 Unauthorized). Check TMDB_API_TOKEN and retry.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { pages: pageCount, local, remote } = parseArgs(process.argv.slice(2));
  const token = resolveToken();

  console.log(`Seeding from TMDB: fetching ${pageCount} discover page(s)...`);

  let genreMap: GenreMap;
  try {
    genreMap = await fetchGenreMap(token);
  } catch (err) {
    abortOn401(err);
    throw err;
  }

  const titlesById = new Map<number, TitleFields>();
  for (let page = 1; page <= pageCount; page++) {
    try {
      const discoverJson = await fetchDiscoverPage(page, token);
      for (const title of discoverPageToTitles(discoverJson, genreMap)) {
        titlesById.set(title.tmdbId, title);
      }
    } catch (err) {
      abortOn401(err);
      console.warn(`Skipping discover page ${page}: ${(err as Error).message}`);
    }
    await sleep(THROTTLE_MS);
  }

  console.log(`Discovered ${titlesById.size} unique title(s). Fetching per-title enrichment (cast/keywords/streaming)...`);

  const now = new Date().toISOString();
  const statements: string[] = [];
  let processed = 0;

  for (const base of titlesById.values()) {
    let enrichment: TitleEnrichment = { topCast: [], keywords: [], streaming: {} };
    try {
      const detail = await fetchMovieDetail(base.tmdbId, token);
      enrichment = detailToEnrichment(detail);
    } catch (err) {
      abortOn401(err);
      console.warn(`Enrichment fetch failed for tmdbId ${base.tmdbId}, seeding base fields only: ${(err as Error).message}`);
    }

    statements.push(titleToInsertStatement({ ...base, ...enrichment }, now));
    processed++;
    if (processed % PROGRESS_INTERVAL === 0) {
      console.log(`Processed ${processed}/${titlesById.size} titles...`);
    }
    await sleep(THROTTLE_MS);
  }

  const outputPath = resolve(process.cwd(), "scripts/seed.sql");
  writeFileSync(outputPath, statements.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${statements.length} INSERT statement(s) to ${outputPath}`);

  if (local || remote) {
    const wranglerArgs = ["wrangler", "d1", "execute", "movie-night-db", ...(local ? ["--local"] : []), "--file=scripts/seed.sql"];
    console.log(`Running: npx ${wranglerArgs.join(" ")}`);
    const result = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
    if (result.status !== 0) {
      console.error("wrangler d1 execute failed.");
      process.exit(result.status ?? 1);
    }
  }
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
