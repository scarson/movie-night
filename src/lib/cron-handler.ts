// ABOUTME: Weekly cron orchestrator that refreshes streaming availability, popularity,
// ABOUTME: and vote counts from TMDB for the titles refreshed least recently.
import { detailToEnrichment, fetchMovieDetail } from "./tmdb";
import { sqliteIsoNow } from "./db";
import { logEvent, type LogSink } from "./log";

// One external subrequest per title (fetchMovieDetail folds keywords, credits
// and watch/providers into a single TMDB request). Workers Paid allows 10,000
// subrequests per invocation, external and internal together; Free allows 50
// external plus a separate 1,000 to Cloudflare services, so there the run's D1
// calls never compete with its TMDB fetches.
// 200/week clears the ~1,000-title seed catalog in about five weeks.
// Workers Paid is required — see docs/deploy.md §Plan-tier check.
const STALE_TITLES_LIMIT = 200;
const BATCH_CHUNK_SIZE = 25;

// A total TMDB outage fails all 200 titles. Naming a handful separates "these
// specific ids are gone upstream" from "TMDB is down" without carrying 200 ids
// into a log line that is capped at 256 KB and billed by volume.
const FAILED_ID_SAMPLE = 10;

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
       WHERE last_refresh_attempt_at IS NULL OR last_refresh_attempt_at < ${sqliteIsoNow("-7 days")}
       ORDER BY last_refreshed_at ASC, popularity DESC
       LIMIT ${STALE_TITLES_LIMIT}`
    )
    .all<StaleTitleRow>();

  const now = new Date().toISOString();
  let refreshed = 0;
  let fetchErrors = 0;
  let writeErrors = 0;
  const failedIds: number[] = [];
  let pending: D1PreparedStatement[] = [];
  let pendingAttempts: D1PreparedStatement[] = [];

  // Commit the queued chunk. Clear `pending` before awaiting so a failed batch
  // isn't re-submitted (and grown) on the next chunk boundary, count the rows
  // the batch actually changed rather than the statements queued, and swallow
  // the failure so one bad chunk neither aborts the run nor propagates out of
  // the final flush. A failed chunk writes no stamp of either kind, so its
  // titles stay candidates and the next run retries them.
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      const results = await db.batch(batch);
      refreshed += results.reduce((rows, result) => rows + (result.meta?.changes ?? 0), 0);
    } catch {
      writeErrors += batch.length;
    }
  };

  // Commit the queued attempt stamps. These ride their own array so their
  // changed rows never reach `refreshed`: a run where every fetch failed writes
  // one attempt stamp per title and must still report zero refreshes.
  const flushAttempts = async (): Promise<void> => {
    if (pendingAttempts.length === 0) return;
    const batch = pendingAttempts;
    pendingAttempts = [];
    try {
      await db.batch(batch);
    } catch {
      writeErrors += batch.length;
    }
  };

  for (const row of stale.results) {
    try {
      const detail = await fetchMovieDetail(row.tmdb_id, env.TMDB_API_TOKEN, fetchImpl);
      const enrichment = detailToEnrichment(detail);
      pending.push(
        db
          .prepare(
            "UPDATE titles SET streaming = ?, popularity = ?, vote_count = ?, vote_average = ?, last_refreshed_at = ?, last_refresh_attempt_at = ? WHERE tmdb_id = ? AND content_type = ?"
          )
          .bind(
            JSON.stringify(enrichment.streaming),
            detail.popularity,
            detail.vote_count,
            detail.vote_average,
            now,
            now,
            row.tmdb_id,
            row.content_type
          )
      );

      if (pending.length >= BATCH_CHUNK_SIZE) {
        await flush();
      }
    } catch {
      fetchErrors++;
      if (failedIds.length < FAILED_ID_SAMPLE) failedIds.push(row.tmdb_id);
      // Record that the title was tried. Without this it keeps satisfying the
      // staleness predicate and re-consumes a slot on every run, starving the
      // tail of the catalog. last_refreshed_at stays untouched because
      // asOfNote() renders it to the user.
      pendingAttempts.push(
        db
          .prepare(
            "UPDATE titles SET last_refresh_attempt_at = ? WHERE tmdb_id = ? AND content_type = ?"
          )
          .bind(now, row.tmdb_id, row.content_type)
      );

      if (pendingAttempts.length >= BATCH_CHUNK_SIZE) {
        await flushAttempts();
      }
    }
  }

  await flush();
  await flushAttempts();

  logEvent(
    "cron_refresh",
    {
      refreshed,
      fetch_errors: fetchErrors,
      write_errors: writeErrors,
      failed_tmdb_ids: failedIds.length > 0 ? failedIds : undefined,
    },
    log
  );
}

/**
 * The cron entry point, split out of worker.ts so it is reachable from a test —
 * worker.ts imports build-time OpenNext artifacts and cannot be imported by one.
 *
 * cron_started is the evidence that the schedule fired at all: without it, a run
 * killed by the CPU budget or a dead isolate is indistinguishable from a trigger
 * that was never registered. Its presence with no matching cron_refresh or
 * cron_failed is the signature of a run that died mid-flight.
 *
 * Do not hand the refresh promise to ctx.waitUntil: a rejection there still
 * reports the invocation successful to Cloudflare's cron metrics. Awaiting and
 * rethrowing marks it failed. Cron invocations get a 15-minute budget, so
 * awaiting the whole refresh is safe.
 */
export async function runScheduled(
  controller: { cron: string; scheduledTime: number },
  env: CloudflareEnv,
  fetchImpl: typeof fetch = fetch,
  log: LogSink = console.log,
  logError: LogSink = console.error
): Promise<void> {
  const schedule = {
    cron: controller.cron,
    scheduled_time: new Date(controller.scheduledTime).toISOString(),
  };
  logEvent("cron_started", schedule, log);

  try {
    await runWeeklyRefresh(env, fetchImpl, log);
  } catch (err) {
    logEvent("cron_failed", { ...schedule, message: String(err) }, logError);
    throw err;
  }
}
