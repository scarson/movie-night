// ABOUTME: Tests for the weekly TMDB streaming-refresh cron — real SQL via fake D1,
// ABOUTME: an injected fetch stub (no network), and an injected log spy (pristine output).
import { describe, expect, it, vi } from "vitest";
import { createFakeD1, loadMigration, withFailingStatement } from "@/test/fake-d1";
import { runWeeklyRefresh } from "./cron-handler";

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

function seedTitles(db: D1Database, count: number): Promise<unknown> {
  const rows: string[] = [];
  for (let i = 1; i <= count; i++) {
    rows.push(`(${i}, 'Title ${i}', ${i}, NULL, NULL, '2020-01-01T00:00:00.000Z')`);
  }
  return db.exec(
    `INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, last_refresh_attempt_at, created_at) VALUES ${rows.join(",")}`
  );
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

const OLD_TIMESTAMP = "2020-01-01T00:00:00.000Z"; // > 7 days stale under any reasonable "now"
const RECENT_TIMESTAMP = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago: fresh

describe("runWeeklyRefresh", () => {
  it("refreshes only titles unattempted for 7 days, skipping recently attempted ones", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Never Attempted", popularity: 10, lastRefreshedAt: null });
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
    // Attempted an hour ago and never successfully refreshed — the shape a
    // title whose TMDB fetch keeps failing has after a run. It must wait its
    // 7 days like everything else rather than re-consuming a slot.
    await seedTitle(db, {
      tmdbId: 4,
      title: "Recently Attempted, Never Refreshed",
      popularity: 40,
      lastRefreshedAt: null,
      lastRefreshAttemptAt: RECENT_TIMESTAMP,
    });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log);

    const ids = fetchedIds(fetchStub);
    expect(ids.sort()).toEqual([1, 2]);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });

  it("orders refresh candidates by popularity DESC among titles of equal refresh recency", async () => {
    const db = createFakeD1(loadMigration());
    // Every title here has never been refreshed, so popularity is the only
    // discriminator — it is the within-run tiebreaker under the composite
    // ORDER BY last_refreshed_at ASC, popularity DESC.
    await seedTitle(db, { tmdbId: 1, title: "Low", popularity: 10, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "High", popularity: 99, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 3, title: "Mid", popularity: 50, lastRefreshedAt: null });

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
  });

  it("updates streaming, popularity, vote_count, vote_average, and last_refreshed_at for each refreshed title", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 27205, title: "Inception", popularity: 10, lastRefreshedAt: null });

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
    await seedTitle(db, { tmdbId: 1, title: "Will Fail", popularity: 10, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "Will Succeed", popularity: 20, lastRefreshedAt: null });

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

    expect(succeeded!.last_refreshed_at).not.toBeNull();
    expect(failed!.last_refreshed_at).toBeNull();

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
    await seedTitle(db, { tmdbId: 1, title: "Deleted Mid-Run", popularity: 99, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "Survivor", popularity: 10, lastRefreshedAt: null });

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
    await seedTitle(db, { tmdbId: 1, title: "A", popularity: 10, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "B", popularity: 20, lastRefreshedAt: null });

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

  it("sweeps forward across runs instead of re-selecting the same head of the catalog", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitles(db, 400);

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    // The clock is deliberately not advanced between runs: back-to-back
    // invocations must still make progress, because cron jitter alone used to
    // re-qualify the whole popularity head.
    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const firstRun = fetchedIds(fetchStub);
    fetchStub.mockClear();
    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());
    const secondRun = fetchedIds(fetchStub);

    expect(firstRun).toHaveLength(200);
    expect(secondRun).toHaveLength(200);
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
    await seedTitle(db, { tmdbId: 1, title: "Succeeds", popularity: 10, lastRefreshedAt: null });

    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse(detailFixture(1))));

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const row = await db
      .prepare("SELECT last_refreshed_at, last_refresh_attempt_at FROM titles WHERE tmdb_id = 1")
      .first<{ last_refreshed_at: string; last_refresh_attempt_at: string }>();

    expect(row!.last_refreshed_at).not.toBeNull();
    expect(row!.last_refresh_attempt_at).toBe(row!.last_refreshed_at);
  });

  it("selects never-refreshed titles before stale ones, and stale before recent", async () => {
    const db = createFakeD1(loadMigration());
    // Popularity is inverted against refresh recency, so an order matching the
    // recency sequence can only come from the last_refreshed_at leg.
    await seedTitle(db, { tmdbId: 1, title: "Never", popularity: 1, lastRefreshedAt: null });
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
    await seedTitle(db, { tmdbId: 1, title: "Write Fails", popularity: 10, lastRefreshedAt: null });
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
    expect(row!.last_refreshed_at).toBeNull();
    expect(row!.last_refresh_attempt_at).toBeNull();
  });

  it("counts a failed attempt stamp as a write error and keeps going", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Both Fail", popularity: 10, lastRefreshedAt: null });
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
