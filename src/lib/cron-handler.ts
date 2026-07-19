// ABOUTME: Weekly cron orchestrator that refreshes streaming availability, popularity,
// ABOUTME: and vote counts for the most-popular stale titles from TMDB.
import { detailToEnrichment, fetchMovieDetail } from "./tmdb";
import { sqliteIsoNow } from "./db";

// ~200 TMDB detail fetches per invocation requires the Workers Paid plan's
// 1000-subrequest limit. The Free plan caps at 50 subrequests/invocation —
// if the account is on Free at deploy time, lower this to 40 (see
// dev/implementation-log.md Task 3.3).
const STALE_TITLES_LIMIT = 200;
const BATCH_CHUNK_SIZE = 25;

interface StaleTitleRow {
  tmdb_id: number;
  content_type: string;
}

export async function runWeeklyRefresh(
  env: CloudflareEnv,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log
): Promise<void> {
  const db = env.DB;

  const stale = await db
    .prepare(
      `SELECT tmdb_id, content_type FROM titles
       WHERE last_refreshed_at IS NULL OR last_refreshed_at < ${sqliteIsoNow("-7 days")}
       ORDER BY popularity DESC
       LIMIT ${STALE_TITLES_LIMIT}`
    )
    .all<StaleTitleRow>();

  const now = new Date().toISOString();
  let refreshed = 0;
  let errors = 0;
  let pending: D1PreparedStatement[] = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    await db.batch(pending);
    pending = [];
  };

  for (const row of stale.results) {
    try {
      const detail = await fetchMovieDetail(row.tmdb_id, env.TMDB_API_TOKEN, fetchImpl);
      const enrichment = detailToEnrichment(detail);
      pending.push(
        db
          .prepare(
            "UPDATE titles SET streaming = ?, popularity = ?, vote_count = ?, vote_average = ?, last_refreshed_at = ? WHERE tmdb_id = ? AND content_type = ?"
          )
          .bind(
            JSON.stringify(enrichment.streaming),
            detail.popularity,
            detail.vote_count,
            detail.vote_average,
            now,
            row.tmdb_id,
            row.content_type
          )
      );
      refreshed++;

      if (pending.length >= BATCH_CHUNK_SIZE) {
        await flush();
      }
    } catch {
      errors++;
    }
  }

  await flush();

  log(JSON.stringify({ event: "cron_refresh", refreshed, errors }));
}
