// ABOUTME: Tests for GET/PUT /api/user/profile — empty defaults, validation limits,
// ABOUTME: and TMDB enrichment of unknown tmdb ids (with the >10-unknown-ids 400 contract).

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

function seedUser(db: D1Database, id: string, name: string) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, name, "2026-01-01T00:00:00.000Z")
    .run();
}

function seedTitle(db: D1Database, tmdbId: number, title: string) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, popularity, created_at)
       VALUES (?, 'movie', ?, 2020, '["Drama"]', 'Synopsis.', 50, '2026-01-01T00:00:00.000Z')`
    )
    .bind(tmdbId, title)
    .run();
}

async function authedGet(userId: string): Promise<NextRequest> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  return new NextRequest("https://example.com/api/user/profile", {
    headers: { cookie: `mn-session=${jwt}` },
  });
}

async function authedPut(userId: string, body: unknown): Promise<NextRequest> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  return new NextRequest("https://example.com/api/user/profile", {
    method: "PUT",
    headers: { cookie: `mn-session=${jwt}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    comfortTitles: [] as number[],
    watchlist: [] as number[],
    vibes: [] as string[],
    dealbreakers: [] as string[],
    streamingServices: [] as string[],
    ...overrides,
  };
}

function tmdbDetail(id: number, title: string) {
  return {
    id,
    title,
    overview: "A movie.",
    release_date: "2015-06-01",
    genres: [{ id: 18, name: "Drama" }],
    poster_path: "/enriched.jpg",
    vote_count: 100,
    vote_average: 7.5,
    popularity: 42.5,
    keywords: { keywords: [{ id: 1, name: "heist" }] },
    credits: { cast: [{ id: 9, name: "Some Actor", character: "Lead", order: 0 }] },
    "watch/providers": { results: { US: { link: "https://tmdb", flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: null, display_priority: 1 }] } } },
  };
}

describe("/api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 when unauthenticated (GET and PUT)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { GET, PUT } = await import("./route");
    const getRes = await GET(new NextRequest("https://example.com/api/user/profile"));
    const putRes = await PUT(
      new NextRequest("https://example.com/api/user/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      })
    );

    expect(getRes.status).toBe(401);
    expect(putRes.status).toBe(401);
  });

  it("GET returns empty defaults when no profile row exists", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { GET } = await import("./route");
    const response = await GET(await authedGet("u1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: { comfortTitles: [], watchlist: [], vibes: [], dealbreakers: [], streamingServices: [] },
    });
  });

  it("PUT saves the profile and GET round-trips it (upsert on second PUT)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedTitle(db, 27205, "Inception");
    await seedTitle(db, 155, "The Dark Knight");

    const { GET, PUT } = await import("./route");
    const body = validBody({
      comfortTitles: [27205],
      watchlist: [155],
      vibes: ["Cozy"],
      dealbreakers: ["Horror"],
      streamingServices: ["Netflix"],
    });
    const putRes = await PUT(await authedPut("u1", body));
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ profile: body });

    const secondBody = validBody({ comfortTitles: [155], vibes: ["Funny"] });
    const putRes2 = await PUT(await authedPut("u1", secondBody));
    expect(putRes2.status).toBe(200);

    const getRes = await GET(await authedGet("u1"));
    expect(await getRes.json()).toEqual({ profile: secondBody });
  });

  it("PUT returns 400 for a malformed JSON body", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", "not json{{{"));
    expect(response.status).toBe(400);
  });

  it("PUT returns 400 (not 500) for a literal null JSON body", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", "null"));
    expect(response.status).toBe(400);
  });

  it("PUT rejects non-array fields and non-integer tmdb ids", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { PUT } = await import("./route");
    expect((await PUT(await authedPut("u1", validBody({ comfortTitles: "nope" })))).status).toBe(400);
    expect((await PUT(await authedPut("u1", validBody({ watchlist: [1.5] })))).status).toBe(400);
    expect((await PUT(await authedPut("u1", validBody({ comfortTitles: ["27205"] })))).status).toBe(400);
    expect((await PUT(await authedPut("u1", { comfortTitles: [] }))).status).toBe(400); // missing fields
  });

  it("PUT rejects title lists over 50 entries and tag lists over 30 entries", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { PUT } = await import("./route");
    const ids51 = Array.from({ length: 51 }, (_, i) => i + 1);
    const tags31 = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    expect((await PUT(await authedPut("u1", validBody({ comfortTitles: ids51 })))).status).toBe(400);
    expect((await PUT(await authedPut("u1", validBody({ vibes: tags31 })))).status).toBe(400);
  });

  it("PUT rejects tags over 30 chars, including a 10k-char string", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { PUT } = await import("./route");
    expect((await PUT(await authedPut("u1", validBody({ vibes: ["x".repeat(31)] })))).status).toBe(400);
    expect(
      (await PUT(await authedPut("u1", validBody({ dealbreakers: ["y".repeat(10_000)] })))).status
    ).toBe(400);
    expect(
      (await PUT(await authedPut("u1", validBody({ streamingServices: [12] })))).status
    ).toBe(400);
  });

  it("PUT accepts boundary values: a 30-char tag and exactly-50-entry title lists", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const ids50: number[] = [];
    const rows: string[] = [];
    for (let i = 1; i <= 50; i++) {
      ids50.push(i);
      rows.push(`(${i}, 'movie', 'Seeded ${i}', 2020, '[]', '', 1, '2026-01-01T00:00:00.000Z')`);
    }
    await db.exec(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, popularity, created_at) VALUES ${rows.join(",")}`
    );

    const { PUT } = await import("./route");
    const response = await PUT(
      await authedPut("u1", validBody({ comfortTitles: ids50, vibes: ["v".repeat(30)] }))
    );
    expect(response.status).toBe(200);
  });

  it("PUT enriches an unknown tmdb id from TMDB and inserts it into titles", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const fetchStub = vi.fn(
      async (input: RequestInfo | URL) => {
        void input;
        return new Response(JSON.stringify(tmdbDetail(42, "Enriched Movie")), { status: 200 });
      }
    );
    vi.stubGlobal("fetch", fetchStub);

    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", validBody({ comfortTitles: [42] })));

    expect(response.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain("/movie/42");

    const row = await db
      .prepare("SELECT * FROM titles WHERE tmdb_id = 42 AND content_type = 'movie'")
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      title: "Enriched Movie",
      year: 2015,
      poster_path: "/enriched.jpg",
      genres: '["Drama"]',
      top_cast: '["Some Actor"]',
      keywords: '["heist"]',
    });
    expect(row?.last_refreshed_at).toBeTruthy();
  });

  it("PUT returns 400 with unknownIds when more than 10 ids are unknown, without fetching", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const { PUT } = await import("./route");
    const unknown = Array.from({ length: 11 }, (_, i) => 9000 + i);
    const response = await PUT(await authedPut("u1", validBody({ comfortTitles: unknown })));

    expect(response.status).toBe(400);
    const body = await response.json<Record<string, unknown>>();
    expect(body.unknownIds).toEqual(unknown);
    expect(fetchStub).not.toHaveBeenCalled();

    const row = await db.prepare("SELECT * FROM profiles WHERE user_id = 'u1'").first();
    expect(row).toBeNull();
  });

  it("PUT reports unknown ids in the order they were referenced", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    for (const id of [300, 100, 500]) await seedTitle(db, id, `Known ${id}`);

    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    // Known and unknown ids interleaved, neither group ascending — an ascending
    // fixture makes "the referenced order survived" look self-evidently true.
    const referenced = [
      9005, 300, 9001, 9009, 100, 9003, 9000, 9007, 500, 9002, 9008, 9004, 9006, 9010,
    ];
    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", validBody({ comfortTitles: referenced })));

    expect(response.status).toBe(400);
    const body = await response.json<Record<string, unknown>>();
    expect(body.unknownIds).toEqual([
      9005, 9001, 9009, 9003, 9000, 9007, 9002, 9008, 9004, 9006, 9010,
    ]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("PUT checks more referenced ids than a single D1 statement can bind", async () => {
    // The existence check ran one statement per id, so a full profile meant 100 D1
    // round-trips inside the request that blocks the ritual's "Continue" button.
    const base = createFakeD1(loadMigration());
    const { db, statements } = recordStatements(base);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(base, "u1", "Sam");
    for (let i = 1; i <= 100; i++) await seedTitle(base, i, `Title ${i}`);

    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    const comfortTitles = Array.from({ length: 50 }, (_, i) => i + 1);
    const watchlist = Array.from({ length: 50 }, (_, i) => i + 51);
    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", validBody({ comfortTitles, watchlist })));

    expect(response.status).toBe(200);
    expect(fetchStub).not.toHaveBeenCalled();

    const reads = statements.filter((s) => /SELECT[\s\S]*FROM titles/.test(s.sql));
    expect(reads.length).toBeLessThanOrEqual(Math.ceil(100 / D1_IN_CHUNK_SIZE));
    expect(Math.max(...reads.map((s) => s.boundParams))).toBeLessThanOrEqual(D1_IN_CHUNK_SIZE);
  });

  it("PUT returns 400 listing failed ids when a TMDB fetch fails, and saves nothing", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const fetchStub = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchStub);

    const { PUT } = await import("./route");
    const response = await PUT(await authedPut("u1", validBody({ watchlist: [777] })));

    expect(response.status).toBe(400);
    const body = await response.json<Record<string, unknown>>();
    expect(body.failedIds).toEqual([777]);

    const row = await db.prepare("SELECT * FROM profiles WHERE user_id = 'u1'").first();
    expect(row).toBeNull();
  });
});
