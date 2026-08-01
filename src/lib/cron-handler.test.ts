// ABOUTME: Tests for the weekly TMDB streaming-refresh cron — real SQL via fake D1,
// ABOUTME: an injected fetch stub (no network), and an injected log spy (pristine output).
import { describe, expect, it, vi } from "vitest";
import { createFakeD1, loadMigration, withFailingStatement } from "@/test/fake-d1";
import { runWeeklyRefresh } from "./cron-handler";

const OLD_TIMESTAMP = "2020-01-01T00:00:00.000Z"; // > 7 days stale under any reasonable "now"
const RECENT_TIMESTAMP = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago: fresh

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function fakeEnv(db: D1Database, overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    JWT_SECRET: "test-jwt-secret",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    TMDB_API_TOKEN: "test-tmdb-token",
    ...overrides,
  };
}

function seedTitle(
  db: D1Database,
  opts: {
    tmdbId: number;
    title: string;
    popularity: number;
    lastRefreshedAt: string | null;
    lastRefreshAttemptAt?: string | null;
  }
): Promise<unknown> {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, last_refresh_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      opts.tmdbId,
      opts.title,
      opts.popularity,
      opts.lastRefreshedAt,
      opts.lastRefreshAttemptAt ?? null,
      "2020-01-01T00:00:00.000Z"
    )
    .run();
}

/** The ids the injected fetch was asked for, in call order. */
function fetchedIds(stub: { mock: { calls: unknown[][] } }): number[] {
  return stub.mock.calls.map(([url]) => Number(new URL(String(url)).pathname.split("/").pop()));
}

/**
 * Seeds a catalog whose rows all carry the same long-past refresh history —
 * the shape a seeded catalog has once the migration's backfill has run. Every
 * writer of a titles row sets last_refreshed_at, so a NULL there is not a state
 * production can reach (testing-pitfalls §7). Popularity equals the id, so the
 * most popular title is the highest-numbered one.
 */
function seedTitles(db: D1Database, count: number): Promise<unknown> {
  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    rows.push(`(${i}, 'Title ${i}', ${i}, '${OLD_TIMESTAMP}', '${OLD_TIMESTAMP}', '2020-01-01T00:00:00.000Z')`);
  }
  return db.exec(
    `INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, last_refresh_attempt_at, created_at) VALUES ${rows.join(",")}`
  );
}

/**
 * Rewinds every stored refresh timestamp by 8 days, so the next run sees the
 * catalog as a week older. The fake D1's clock is SQLite's own `now`, which the
 * suite cannot move; moving the data is equivalent for a predicate and an
 * ORDER BY that only ever compare stored timestamps against it.
 */
function rewindOneWeek(db: D1Database): Promise<unknown> {
  return db
    .prepare(
      `UPDATE titles SET
         last_refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_refreshed_at, '-8 days'),
         last_refresh_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_refresh_attempt_at, '-8 days')`
    )
    .run();
}

function detailFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    overview: "",
    release_date: "2020-01-01",
    genres: [],
    poster_path: null,
    vote_count: 1000 + id,
    vote_average: 7.5,
    popularity: 50 + id,
    "watch/providers": {
      results: {
        US: {
          link: `https://example.com/watch/${id}`,
          flatrate: [{ provider_id: 1, provider_name: "Max", logo_path: null, display_priority: 0 }],
        },
      },
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("runWeeklyRefresh", () => {
  it("refreshes only titles unattempted for 7 days, skipping recently attempted ones", async () => {
    const db = createFakeD1(loadMigration());
    // Inserted by the catalog seeder and never touched by the cron: refreshed
    // at insert time, never attempted since.
    await seedTitle(db, { tmdbId: 1, title: "Seeded, Never Attempted", popularity: 10, lastRefreshedAt: RECENT_TIMESTAMP });
    await seedTitle(db, {
      tmdbId: 2,
      title: "Stale Old",
      popularity: 20,
      lastRefreshedAt: OLD_TIMESTAMP,
      lastRefreshAttemptAt: OLD_TIMESTAMP,
    });
    await seedTitle(db, {
      tmdbId: 3,
      title: "Fresh",
      popularity: 30,
      lastRefreshedAt: RECENT_TIMESTAMP,
      lastRefreshAttemptAt: RECENT_TIMESTAMP,
    });
    // Attempted an hour ago and not successfully refreshed since 2020 — the
    // shape a title whose TMDB fetch keeps failing has after a run. It must wait
    // its 7 days like everything else rather than re-consuming a slot.
    await seedTitle(db, {
      tmdbId: 4,
      title: "Recently Attempted, Long Stale",
      popularity: 40,
      lastRefreshedAt: OLD_TIMESTAMP,
      lastRefreshAttemptAt: RECENT_TIMESTAMP,
    });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log);

    const ids = fetchedIds(fetchStub);
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });

  it("puts the staleness boundary at 7 days, not merely somewhere between an hour and years", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, {
      tmdbId: 1,
      title: "Attempted Six Days Ago",
      popularity: 10,
      lastRefreshedAt: daysAgo(6),
      lastRefreshAttemptAt: daysAgo(6),
    });
    await seedTitle(db, {
      tmdbId: 2,
      title: "Attempted Eight Days Ago",
      popularity: 20,
      lastRefreshedAt: daysAgo(8),
      lastRefreshAttemptAt: daysAgo(8),
    });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    // Fixtures years apart cannot tell a 7-day window from a 30-day one, and the
    // window is what makes the sweep weekly.
    expect(fetchedIds(fetchStub)).toEqual([2]);
  });

  it("orders refresh candidates by popularity DESC among titles of equal refresh recency", async () => {
    const db = createFakeD1(loadMigration());
    // Every title here was last refreshed at the same moment, so popularity is
    // the only discriminator — it is the within-run tiebreaker under the
    // composite ORDER BY last_refreshed_at ASC, popularity DESC.
    await seedTitle(db, { tmdbId: 1, title: "Low", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 2, title: "High", popularity: 99, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 3, title: "Mid", popularity: 50, lastRefreshedAt: OLD_TIMESTAMP });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    expect(fetchedIds(fetchStub)).toEqual([2, 3, 1]);
  });

  it("caps refresh candidates at 200 even when more titles are stale", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 205);

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    expect(fetchStub).toHaveBeenCalledTimes(200);
    // Which 200 survive the cap matters, not just how many: seedTitles gives
    // every title an identical long-past refresh history and popularity == its
    // id, so last_refreshed_at ties and popularity DESC decides — the window is
    // the 200 most popular and the five least popular are the ones dropped.
    expect(fetchedIds(fetchStub)).toEqual(
      Array.from({ length: 200 }, (_, i) => 205 - i)
    );
  });

  it("updates streaming, popularity, vote_count, vote_average, and last_refreshed_at for each refreshed title", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 27205, title: "Inception", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });

    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse(detailFixture(27205))));

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const row = await db
      .prepare("SELECT streaming, popularity, vote_count, vote_average, last_refreshed_at FROM titles WHERE tmdb_id = ?")
      .bind(27205)
      .first<{
        streaming: string;
        popularity: number;
        vote_count: number;
        vote_average: number;
        last_refreshed_at: string;
      }>();

    expect(row).not.toBeNull();
    expect(JSON.parse(row!.streaming)).toEqual({
      link: "https://example.com/watch/27205",
      flatrate: ["Max"],
    });
    expect(row!.popularity).toBe(50 + 27205);
    expect(row!.vote_count).toBe(1000 + 27205);
    expect(row!.vote_average).toBe(7.5);
    expect(row!.last_refreshed_at).not.toBeNull();
    expect(new Date(row!.last_refreshed_at).getTime()).toBeGreaterThan(new Date(OLD_TIMESTAMP).getTime());
  });

  it("continues past a per-title fetch failure, counting it as an error instead of throwing", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Will Fail", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 2, title: "Will Succeed", popularity: 20, lastRefreshedAt: OLD_TIMESTAMP });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      if (id === 1) return Promise.resolve(new Response("Server error", { status: 500 }));
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });
    const log = vi.fn();

    await expect(runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log)).resolves.toBeUndefined();

    const succeeded = await db.prepare("SELECT last_refreshed_at FROM titles WHERE tmdb_id = 2").first<{
      last_refreshed_at: string;
    }>();
    const failed = await db.prepare("SELECT last_refreshed_at FROM titles WHERE tmdb_id = 1").first<{
      last_refreshed_at: string | null;
    }>();

    expect(succeeded!.last_refreshed_at).not.toBe(OLD_TIMESTAMP);
    expect(failed!.last_refreshed_at).toBe(OLD_TIMESTAMP);

    const summary = JSON.parse(log.mock.calls[0][0]);
    expect(summary).toEqual({ event: "cron_refresh", refreshed: 1, fetch_errors: 1, write_errors: 0 });
  });

  it("logs a structured cron_refresh summary line with refreshed/error counts, even when nothing is stale", async () => {
    const db = createFakeD1(loadMigration());
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), vi.fn() as unknown as typeof fetch, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 0,
      fetch_errors: 0,
      write_errors: 0,
    });
  });

  it("counts rows written, not statements queued", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Deleted Mid-Run", popularity: 99, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 2, title: "Survivor", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });

    // Removing the row between the stale SELECT and the flush is the only way a
    // queued UPDATE can legitimately match zero rows: the statement binds
    // row.content_type straight from the SELECT that produced it, so the bound
    // value can never disagree with the stored one.
    const fetchStub = vi.fn(async (url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      if (id === 2) await db.prepare("DELETE FROM titles WHERE tmdb_id = 1").run();
      return jsonResponse(detailFixture(id));
    });
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log);

    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 1,
      fetch_errors: 0,
      write_errors: 0,
    });
  });

  it("batches D1 updates in chunks of 25", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 30);

    const batchSpy = vi.spyOn(db, "batch");
    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect((batchSpy.mock.calls[0][0] as unknown[]).length).toBe(25);
    expect((batchSpy.mock.calls[1][0] as unknown[]).length).toBe(5);
  });

  it("counts a failed batch as write errors (not refreshed) and does not throw or resubmit it", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "A", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 2, title: "B", popularity: 20, lastRefreshedAt: OLD_TIMESTAMP });

    // A batch write that always rejects: the summary must report the chunk as
    // errors (not queued-and-counted-as-refreshed), the function must resolve
    // rather than propagate the final-flush failure, and the failed statements
    // must not be re-submitted on the next chunk boundary.
    const batchSpy = vi.fn(() => Promise.reject(new Error("D1 batch write failed")));
    const failingDb = { ...db, batch: batchSpy } as unknown as D1Database;
    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });
    const log = vi.fn();

    await expect(
      runWeeklyRefresh(fakeEnv(failingDb), fetchStub as unknown as typeof fetch, log)
    ).resolves.toBeUndefined();

    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 0,
      fetch_errors: 0,
      write_errors: 2,
    });
    // One flush attempt for the two-statement batch — never resubmitted.
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it("serves the tail of the catalog on the following week's run", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 400);

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const firstRun = fetchedIds(fetchStub);
    // A week passes, which re-qualifies all 400 titles for staleness. The
    // second run must still reach the tail: what keeps the 200 already
    // refreshed out of the window is that they now sort last, not that they
    // are ineligible.
    await rewindOneWeek(db);
    fetchStub.mockClear();
    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const secondRun = fetchedIds(fetchStub);

    expect(firstRun).toHaveLength(200);
    expect(secondRun).toHaveLength(200);
    expect(secondRun.filter((id) => firstRun.includes(id))).toEqual([]);
    expect(new Set([...firstRun, ...secondRun]).size).toBe(400);
  });

  // A guard on the degenerate cadence, not a proof of the fix: with every fetch
  // succeeding, a predicate on either timestamp column advances. The discriminating
  // case is the week-elapsed sweep above.
  it("makes forward progress on a run that follows immediately, with no time elapsed", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 400);

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const firstRun = fetchedIds(fetchStub);
    fetchStub.mockClear();
    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const secondRun = fetchedIds(fetchStub);

    expect(secondRun.filter((id) => firstRun.includes(id))).toEqual([]);
    expect(new Set([...firstRun, ...secondRun]).size).toBe(400);
  });

  it("stops a permanently-failing title from holding a slot on the next run", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 250);
    // Popularity 250 is the highest seeded, so this title is guaranteed into
    // the first run's window under the composite ordering.
    const alwaysFailingId = 250;

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      if (id === alwaysFailingId) return Promise.resolve(new Response("Server error", { status: 500 }));
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const attempts = fetchedIds(fetchStub).filter((id) => id === alwaysFailingId);
    expect(attempts).toEqual([alwaysFailingId]);
  });

  it("stamps only the attempt column when the fetch fails, never the freshness the UI renders", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, {
      tmdbId: 1,
      title: "Always Fails",
      popularity: 10,
      lastRefreshedAt: OLD_TIMESTAMP,
      lastRefreshAttemptAt: OLD_TIMESTAMP,
    });

    const fetchStub = vi.fn(() => Promise.resolve(new Response("Server error", { status: 500 })));

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const row = await db
      .prepare("SELECT last_refreshed_at, last_refresh_attempt_at FROM titles WHERE tmdb_id = 1")
      .first<{ last_refreshed_at: string; last_refresh_attempt_at: string }>();

    // asOfNote() renders last_refreshed_at to the user, so a failed fetch must
    // leave it exactly as it was.
    expect(row!.last_refreshed_at).toBe(OLD_TIMESTAMP);
    expect(new Date(row!.last_refresh_attempt_at).getTime()).toBeGreaterThan(
      new Date(OLD_TIMESTAMP).getTime()
    );
  });

  it("stamps both the attempt and the refresh columns when the fetch succeeds", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Succeeds", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });

    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse(detailFixture(1))));

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const row = await db
      .prepare("SELECT last_refreshed_at, last_refresh_attempt_at FROM titles WHERE tmdb_id = 1")
      .first<{ last_refreshed_at: string; last_refresh_attempt_at: string }>();

    expect(row!.last_refreshed_at).not.toBeNull();
    expect(row!.last_refresh_attempt_at).toBe(row!.last_refreshed_at);
  });

  it("selects the least recently refreshed titles first, regardless of popularity", async () => {
    const db = createFakeD1(loadMigration());
    // Popularity is inverted against refresh recency, so an order matching the
    // recency sequence can only come from the last_refreshed_at leg.
    await seedTitle(db, { tmdbId: 1, title: "Oldest", popularity: 1, lastRefreshedAt: "2019-01-01T00:00:00.000Z" });
    await seedTitle(db, { tmdbId: 2, title: "Old", popularity: 50, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 3, title: "Recent", popularity: 99, lastRefreshedAt: RECENT_TIMESTAMP });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    expect(fetchedIds(fetchStub)).toEqual([1, 2, 3]);
  });

  it("counts a failed refresh write as a write error and keeps going", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Write Fails", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });
    const failingDb = withFailingStatement(db, { match: "UPDATE titles SET streaming" });

    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse(detailFixture(1))));
    const log = vi.fn();

    await expect(
      runWeeklyRefresh(fakeEnv(failingDb), fetchStub as unknown as typeof fetch, log)
    ).resolves.toBeUndefined();

    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 0,
      fetch_errors: 0,
      write_errors: 1,
    });
    // The batch rolled back, so the title is untouched and stays a candidate.
    const row = await db
      .prepare("SELECT last_refreshed_at, last_refresh_attempt_at FROM titles WHERE tmdb_id = 1")
      .first<{ last_refreshed_at: string | null; last_refresh_attempt_at: string | null }>();
    expect(row!.last_refreshed_at).toBe(OLD_TIMESTAMP);
    expect(row!.last_refresh_attempt_at).toBeNull();
  });

  it("counts a failed attempt stamp as a write error and keeps going", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Both Fail", popularity: 10, lastRefreshedAt: OLD_TIMESTAMP });
    const failingDb = withFailingStatement(db, { match: "UPDATE titles SET last_refresh_attempt_at" });

    const fetchStub = vi.fn(() => Promise.resolve(new Response("Server error", { status: 500 })));
    const log = vi.fn();

    await expect(
      runWeeklyRefresh(fakeEnv(failingDb), fetchStub as unknown as typeof fetch, log)
    ).resolves.toBeUndefined();

    // The title failed both its fetch and the write recording that attempt —
    // the two counters describe different failures, so both report it.
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 0,
      fetch_errors: 1,
      write_errors: 1,
    });
  });

  it("never counts an attempt stamp as a refresh", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 3);

    const fetchStub = vi.fn(() => Promise.resolve(new Response("Server error", { status: 500 })));
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log);

    // Every fetch failed, so the only writes are attempt stamps. Counting their
    // changed rows as refreshes would report a full run of refreshes for a run
    // that refreshed nothing.
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "cron_refresh",
      refreshed: 0,
      fetch_errors: 3,
      write_errors: 0,
    });
  });
});
