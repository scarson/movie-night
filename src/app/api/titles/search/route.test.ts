// ABOUTME: Tests for GET /api/titles/search — auth gating, wildcard sanitization,
// ABOUTME: local-catalog-first search, and the <3-local-hits TMDB merge fallback.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { recordStatements } from "@/test/statement-recorder";
import { D1_IN_CHUNK_SIZE } from "@/lib/db";
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

/** Calls the route with a raw query string (for the ids= / popular= modes). */
async function lookup(queryString: string, userId = "u1"): Promise<Response> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const { GET } = await import("./route");
  return GET(
    new NextRequest(`https://example.com/api/titles/search?${queryString}`, {
      headers: { cookie: `mn-session=${jwt}` },
    })
  );
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

describe("GET /api/titles/search?ids= (saved-id resolution)", () => {
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
    const response = await GET(new NextRequest("https://example.com/api/titles/search?ids=1,2"));
    expect(response.status).toBe(401);
  });

  it("resolves ids in the order requested, skipping unknown ids, without calling TMDB", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien", 10);
    await seedTitle(db, 2, "Arrival", 90);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    // Requested order is the user's saved order — NOT popularity order.
    const body = await (await lookup("ids=2,999,1")).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results.map((r) => r.tmdbId)).toEqual([2, 1]);
    expect(body.results[0]).toEqual({ tmdbId: 2, title: "Arrival", year: 2020, posterPath: "/p.jpg" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("ignores non-integer id entries and returns empty when none survive", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    vi.stubGlobal("fetch", vi.fn());

    expect(await (await lookup("ids=abc,,1.5")).json()).toEqual({ results: [] });
    expect(await (await lookup("ids=")).json()).toEqual({ results: [] });
  });

  it("caps resolution at 100 ids", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    for (let i = 1; i <= 120; i++) await seedTitle(db, i, `Title ${i}`);
    vi.stubGlobal("fetch", vi.fn());

    const ids = Array.from({ length: 120 }, (_, i) => i + 1).join(",");
    const body = await (await lookup(`ids=${ids}`)).json<{ results: unknown[] }>();
    expect(body.results).toHaveLength(100);
  });

  it("resolves a full 100-id profile in the requested order", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    for (let i = 1; i <= 100; i++) await seedTitle(db, i, `Title ${i}`);
    vi.stubGlobal("fetch", vi.fn());

    // Reversed, so a result set that merely came back in row order would fail.
    const requested = Array.from({ length: 100 }, (_, i) => 100 - i);
    const body = await (
      await lookup(`ids=${requested.join(",")}`)
    ).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results.map((r) => r.tmdbId)).toEqual(requested);
  });

  it("keeps every statement under D1's parameter ceiling, with headroom", async () => {
    // MAX_RESOLVED_IDS is 100 and D1 rejects only above 100, so an unchunked
    // resolution sits at the ceiling with zero headroom: one added fixed parameter,
    // or one raised profile cap, breaks it in production only. The fake cannot tell
    // "at the limit" from "one over", so the width itself is what gets asserted —
    // docs/pitfalls/implementation-pitfalls.md PLAT-1.
    const base = createFakeD1(loadMigration());
    const { db, statements } = recordStatements(base);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(base, "u1");
    for (let i = 1; i <= 100; i++) await seedTitle(base, i, `Title ${i}`);
    vi.stubGlobal("fetch", vi.fn());

    const requested = Array.from({ length: 100 }, (_, i) => i + 1);
    const body = await (
      await lookup(`ids=${requested.join(",")}`)
    ).json<{ results: Array<{ tmdbId: number }> }>();

    expect(body.results).toHaveLength(100);
    const reads = statements.filter((s) => /SELECT[\s\S]*FROM titles/.test(s.sql));
    // Guards the assertion below against passing vacuously: an empty filter would
    // make Math.max return -Infinity, which clears any ceiling.
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.length).toBeLessThanOrEqual(Math.ceil(100 / D1_IN_CHUNK_SIZE));
    expect(Math.max(...reads.map((s) => s.boundParams))).toBeLessThanOrEqual(D1_IN_CHUNK_SIZE);
  });

  it("preserves the caller's order across the chunk boundary", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    for (let i = 1; i <= 100; i++) await seedTitle(db, i, `Title ${i}`);
    vi.stubGlobal("fetch", vi.fn());

    // Interleaves ids from either side of the 90-item boundary, so a result set
    // ordered per chunk would surface as the first chunk's ids bunching in front.
    const requested: number[] = [];
    for (let i = 0; i < 50; i++) requested.push(i + 1, i + 51);
    const body = await (
      await lookup(`ids=${requested.join(",")}`)
    ).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results.map((r) => r.tmdbId)).toEqual(requested);
  });

  it("takes precedence over q so a stray query can't change the resolved set", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    await seedTitle(db, 1, "Alien");
    await seedTitle(db, 2, "Arrival");
    vi.stubGlobal("fetch", vi.fn());

    const body = await (await lookup("ids=1&q=arrival")).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results.map((r) => r.tmdbId)).toEqual([1]);
  });
});

describe("GET /api/titles/search?popular=1 (quick picks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the most popular catalog titles, capped at 12, without calling TMDB", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    for (let i = 1; i <= 15; i++) await seedTitle(db, i, `Title ${i}`, i);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const body = await (await lookup("popular=1")).json<{ results: Array<{ tmdbId: number }> }>();
    expect(body.results).toHaveLength(12);
    expect(body.results[0].tmdbId).toBe(15); // highest popularity first
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("returns an empty list on an unseeded catalog rather than erroring", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1");
    vi.stubGlobal("fetch", vi.fn());

    expect(await (await lookup("popular=1")).json()).toEqual({ results: [] });
  });
});
