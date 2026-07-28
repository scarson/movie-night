// ABOUTME: Tests for the weekly TMDB streaming-refresh cron — real SQL via fake D1,
// ABOUTME: an injected fetch stub (no network), and an injected log spy (pristine output).
import { describe, expect, it, vi } from "vitest";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
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
  opts: { tmdbId: number; title: string; popularity: number; lastRefreshedAt: string | null }
): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(opts.tmdbId, opts.title, opts.popularity, opts.lastRefreshedAt, "2020-01-01T00:00:00.000Z")
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

const OLD_TIMESTAMP = "2020-01-01T00:00:00.000Z"; // > 7 days stale under any reasonable "now"
const RECENT_TIMESTAMP = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago: fresh

describe("runWeeklyRefresh", () => {
  it("refreshes only stale titles (NULL or > 7 days old last_refreshed_at), skipping fresh ones", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Stale Null", popularity: 10, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "Stale Old", popularity: 20, lastRefreshedAt: OLD_TIMESTAMP });
    await seedTitle(db, { tmdbId: 3, title: "Fresh", popularity: 30, lastRefreshedAt: RECENT_TIMESTAMP });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, log);

    const fetchedIds = fetchStub.mock.calls.map(([url]) => Number(new URL(String(url)).pathname.split("/").pop()));
    expect(fetchedIds.sort()).toEqual([1, 2]);
    expect(fetchedIds).not.toContain(3);
  });

  it("orders refresh candidates by popularity DESC", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, { tmdbId: 1, title: "Low", popularity: 10, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 2, title: "High", popularity: 99, lastRefreshedAt: null });
    await seedTitle(db, { tmdbId: 3, title: "Mid", popularity: 50, lastRefreshedAt: null });

    const fetchStub = vi.fn((url: string | URL) => {
      const id = Number(new URL(String(url)).pathname.split("/").pop());
      return Promise.resolve(jsonResponse(detailFixture(id)));
    });

    await runWeeklyRefresh(fakeEnv(db), fetchStub as unknown as typeof fetch, vi.fn());

    const fetchedIds = fetchStub.mock.calls.map(([url]) => Number(new URL(String(url)).pathname.split("/").pop()));
    expect(fetchedIds).toEqual([2, 3, 1]);
  });

  it("caps refresh candidates at 200 even when more titles are stale", async () => {
    const db = createFakeD1(loadMigration());
    const rows: string[] = [];
    for (let i = 1; i <= 205; i++) {
      rows.push(`(${i}, 'Title ${i}', ${i}, NULL, '2020-01-01T00:00:00.000Z')`);
    }
    await db.exec(`INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, created_at) VALUES ${rows.join(",")}`);

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
    expect(summary).toEqual({ event: "cron_refresh", refreshed: 1, errors: 1 });
  });

  it("logs a structured cron_refresh summary line with refreshed/error counts, even when nothing is stale", async () => {
    const db = createFakeD1(loadMigration());
    const log = vi.fn();

    await runWeeklyRefresh(fakeEnv(db), vi.fn() as unknown as typeof fetch, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "cron_refresh", refreshed: 0, errors: 0 });
  });

  it("batches D1 updates in chunks of 25", async () => {
    const db = createFakeD1(loadMigration());
    const rows: string[] = [];
    for (let i = 1; i <= 30; i++) {
      rows.push(`(${i}, 'Title ${i}', ${i}, NULL, '2020-01-01T00:00:00.000Z')`);
    }
    await db.exec(`INSERT INTO titles (tmdb_id, title, popularity, last_refreshed_at, created_at) VALUES ${rows.join(",")}`);

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

  it("counts a failed batch as errors (not refreshed) and does not throw or resubmit it", async () => {
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

    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ event: "cron_refresh", refreshed: 0, errors: 2 });
    // One flush attempt for the two-statement batch — never resubmitted.
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });
});
