// ABOUTME: Tests for GET /api/titles/search — auth gating, wildcard sanitization,
// ABOUTME: local-catalog-first search, and the <3-local-hits TMDB merge fallback.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

const JWT_SECRET = "test-jwt-secret";

function fakeEnv(db: D1Database): CloudflareEnv {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    JWT_SECRET,
    ANTHROPIC_API_KEY: "test-anthropic-key",
    TMDB_API_TOKEN: "test-tmdb-token",
  };
}

function seedUser(db: D1Database, id: string) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, 'Sam', ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, "2026-01-01T00:00:00.000Z")
    .run();
}

function seedTitle(db: D1Database, tmdbId: number, title: string, popularity = 50) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path, popularity, created_at)
       VALUES (?, 'movie', ?, 2020, '["Drama"]', 'Synopsis.', '/p.jpg', ?, '2026-01-01T00:00:00.000Z')`
    )
    .bind(tmdbId, title, popularity)
    .run();
}

async function search(q: string | null, userId = "u1"): Promise<Response> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const url =
    q === null
      ? "https://example.com/api/titles/search"
      : `https://example.com/api/titles/search?q=${encodeURIComponent(q)}`;
  const { GET } = await import("./route");
  return GET(new NextRequest(url, { headers: { cookie: `mn-session=${jwt}` } }));
}

function tmdbSearchResponse(entries: Array<{ id: number; title: string }>) {
  return {
    page: 1,
    results: entries.map((e) => ({
      id: e.id,
      title: e.title,
      overview: "",
      release_date: "2019-05-01",
      genre_ids: [18],
      poster_path: "/tmdb.jpg",
      vote_count: 10,
      vote_average: 7,
      popularity: 5,
    })),
    total_pages: 1,
    total_results: entries.length,
  };
}

describe("GET /api/titles/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://example.com/api/titles/search?q=alien"));
    expect(response.status).toBe(401);
  });

  it("returns empty results for a missing or sub-2-char query without querying anything", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    expect(await (await search(null)).json()).toEqual({ results: [] });
    expect(await (await search("a")).json()).toEqual({ results: [] });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("strips SQL LIKE wildcards — a wildcard-only query cannot dump the catalog", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    await seedTitle(db, 2, "Blade Runner");
    vi.stubGlobal("fetch", vi.fn());

    // "%%" and "%a%" reduce to "" / "a" after stripping — both under the 2-char floor.
    expect(await (await search("%%")).json()).toEqual({ results: [] });
    expect(await (await search("%a%")).json()).toEqual({ results: [] });
  });

  it("strips underscores so they don't act as single-char wildcards", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Axb Movie", 90);
    await seedTitle(db, 2, "The ab chronicles", 80);
    await seedTitle(db, 3, "The ab saga", 70);
    vi.stubGlobal("fetch", vi.fn());

    const body = await (await search("a_b")).json<{ results: Array<{ tmdbId: number }> }>();
    // "a_b" → "ab": matches the literal-"ab" titles, NOT "Axb" via wildcard.
    expect(body.results.map((r) => r.tmdbId)).toEqual([2, 3]);
  });

  it("matches the local catalog case-insensitively, ordered by popularity, capped at 10", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    for (let i = 1; i <= 12; i++) {
      await seedTitle(db, i, `ALIEN Part ${i}`, 100 - i);
    }
    vi.stubGlobal("fetch", vi.fn());

    const body = await (await search("alien")).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results).toHaveLength(10);
    expect(body.results[0]).toEqual({ tmdbId: 1, title: "ALIEN Part 1", year: 2020, posterPath: "/p.jpg" });
  });

  it("does not call TMDB when 3+ local hits exist", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    await seedTitle(db, 2, "Aliens");
    await seedTitle(db, 3, "Alien 3");
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const body = await (await search("alien")).json<{ results: unknown[] }>();
    expect(body.results).toHaveLength(3);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("merges TMDB results (deduped, local first) when fewer than 3 local hits", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien", 90);
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        JSON.stringify(
          tmdbSearchResponse([
            { id: 1, title: "Alien" }, // duplicate of the local hit — must dedupe
            { id: 348, title: "Alien: Covenant" },
          ])
        ),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchStub);

    const body = await (await search("alien")).json<{ results: Array<{ tmdbId: number; title: string; posterPath: string }> }>();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain("/search/movie");
    expect(body.results.map((r) => r.tmdbId)).toEqual([1, 348]);
    expect(body.results[0].posterPath).toBe("/p.jpg"); // local wins the dedupe
    expect(body.results[1]).toEqual({ tmdbId: 348, title: "Alien: Covenant", year: 2019, posterPath: "/tmdb.jpg" });
  });

  it("falls back to local-only results when the TMDB call fails (error logged, not thrown)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await search("alien");
    expect(response.status).toBe(200);
    const body = await response.json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results.map((r) => r.tmdbId)).toEqual([1]);

    // The outage is logged (captured here to keep test output pristine).
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][1])).toContain("500");
    errorSpy.mockRestore();
  });
});
