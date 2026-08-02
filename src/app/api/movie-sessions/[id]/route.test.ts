// ABOUTME: Tests for GET /api/movie-sessions/[id] — member-only 404, reload state
// ABOUTME: (session + latest round + titles map), and rough-day privacy.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { recordStatements } from "@/test/statement-recorder";
import { createJWT } from "@/lib/auth";
import { createMovieSession, insertRecommendation } from "@/lib/movie-sessions";
import { deleteAccount, DELETED_USER_LABEL } from "@/lib/account";
import { leaveGroup } from "@/lib/groups";
import type { MatchingResponse } from "@/types/matching";

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

async function seedGroupWithMembers(db: D1Database, groupId: string, memberIds: string[]) {
  await db
    .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, 'Test Group', ?, ?)")
    .bind(groupId, `code-${groupId}`, "2026-01-01T00:00:00.000Z")
    .run();
  for (const userId of memberIds) {
    await db
      .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), groupId, userId, "2026-01-01T00:00:00.000Z")
      .run();
  }
}

function seedTitle(db: D1Database, tmdbId: number, title: string) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path, popularity, streaming, last_refreshed_at, created_at)
       VALUES (?, 'movie', ?, 2020, '["Drama"]', 'Synopsis.', '/p.jpg', 50, '{"flatrate":["Netflix"]}', '2026-07-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
    .bind(tmdbId, title)
    .run();
}

async function get(sessionId: string, userId: string): Promise<Response> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const { GET } = await import("./route");
  return GET(
    new NextRequest(`https://example.com/api/movie-sessions/${sessionId}`, {
      headers: { cookie: `mn-session=${jwt}` },
    }),
    { params: Promise.resolve({ id: sessionId }) }
  );
}

function sampleResponse(tmdbIds: number[]): MatchingResponse {
  return {
    tasteMap: {
      members: [
        { userId: "u1", name: "Sam", summary: "s", primaryVibes: [], genreAffinities: [] },
        { userId: "u2", name: "Alex", summary: "s", primaryVibes: [], genreAffinities: [] },
      ],
      overlap: { summary: "o", sharedVibes: [], tensionPoints: [] },
    },
    recommendations: tmdbIds.map((id) => ({ tmdbId: id, matchScore: 90, explanation: "e" })),
    conversational: "c",
  };
}

async function setupSession(db: D1Database, opts: { roughDay?: boolean; memberFlags?: Record<string, { roughDay: boolean }> } = {}) {
  await seedUser(db, "u1", "Sam");
  await seedUser(db, "u2", "Alex");
  await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
  const { sessionId } = await createMovieSession(db, {
    userId: "u1",
    groupId: "grp1",
    moodVibes: ["Cozy"],
    moodText: "chill",
    discoverNew: false,
    isQuickMatch: false,
    roughDay: opts.roughDay ?? false,
    memberFlags: opts.memberFlags,
  });
  return sessionId;
}

describe("GET /api/movie-sessions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://example.com/api/movie-sessions/s1"), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns identical 404s for non-members and unknown sessions", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db);
    await seedUser(db, "outsider", "Mallory");

    const nonMember = await get(sessionId, "outsider");
    const unknown = await get("no-such-session", "u1");

    expect(nonMember.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await nonMember.text()).toBe(await unknown.text());
  });

  it("returns round 0 with null response for a session with no rounds yet", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db);

    const response = await get(sessionId, "u1");
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.session).toMatchObject({
      id: sessionId,
      groupId: "grp1",
      moodVibes: ["Cozy"],
      moodText: "chill",
      discoverNew: false,
      isQuickMatch: false,
      solo: false,
      roughDay: false,
    });
    expect(body.round).toBe(0);
    expect(body.response).toBeNull();
    expect(body.titles).toEqual({});
  });

  it("returns the latest round with its response and hydrated titles map (incl. lastRefreshedAt)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db);
    await seedTitle(db, 27205, "Inception");
    await seedTitle(db, 155, "The Dark Knight");
    await seedTitle(db, 603, "The Matrix");

    await insertRecommendation(db, {
      sessionId,
      roundNumber: 1,
      aiResponse: sampleResponse([27205]),
      keptTmdbIds: [],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [27205, 155, 603],
    });
    const round2 = sampleResponse([27205, 155, 603]);
    await insertRecommendation(db, {
      sessionId,
      roundNumber: 2,
      aiResponse: round2,
      keptTmdbIds: [27205],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [27205, 155, 603],
    });

    const body = await (await get(sessionId, "u1")).json<Record<string, any>>();
    expect(body.round).toBe(2);
    expect(body.response).toEqual(round2);
    expect(Object.keys(body.titles).map(Number).sort((a, b) => a - b)).toEqual([155, 603, 27205]);
    expect(body.titles[27205]).toEqual({
      title: "Inception",
      year: 2020,
      posterPath: "/p.jpg",
      genres: ["Drama"],
      streaming: { flatrate: ["Netflix"] },
      lastRefreshedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  describe("a stored ai_response that is not a MatchingResponse", () => {
    function seedRawRound(db: D1Database, sessionId: string, aiResponse: string) {
      return db
        .prepare(
          `INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids, removed_tmdb_ids,
             steering_feedback, model, prompt_version, candidate_snapshot, created_at)
           VALUES (?, ?, 3, ?, '[]', '[]', '', 'm', 'p', '[]', ?)`
        )
        .bind(crypto.randomUUID(), sessionId, aiResponse, "2026-01-01T00:00:00.000Z")
        .run();
    }

    it("degrades to response: null and logs, rather than serving a shape the renderer dereferences", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setupSession(db);
      const stored = sampleResponse([27205]) as Partial<MatchingResponse>;
      delete (stored.tasteMap as Partial<MatchingResponse["tasteMap"]>).overlap;
      await seedRawRound(db, sessionId, JSON.stringify(stored));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await get(sessionId, "u1");
      const logged = errorSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string")
        .map((line) => JSON.parse(line));
      errorSpy.mockRestore();

      expect(response.status).toBe(200);
      const body = await response.json<Record<string, any>>();
      expect(body.response).toBeNull();
      expect(body.round).toBe(3);
      expect(body.titles).toEqual({});
      expect(logged).toEqual([{ event: "corrupt_ai_response", session_id: sessionId, round: 3 }]);
    });

    it("logs a blob that is not JSON at all — the commonest corruption", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setupSession(db);
      await seedRawRound(db, sessionId, "not json");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await get(sessionId, "u1");
      const logged = errorSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string")
        .map((line) => JSON.parse(line));
      errorSpy.mockRestore();

      expect(response.status).toBe(200);
      expect((await response.json<Record<string, any>>()).response).toBeNull();
      expect(logged).toEqual([{ event: "corrupt_ai_response", session_id: sessionId, round: 3 }]);
    });
  });

  it("still serves the stored round to someone who has left the group", async () => {
    // Read access to history is deliberately preserved when write/spend access
    // is revoked — POST .../match gates on group_members, this GET does not.
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db);
    await seedTitle(db, 27205, "Inception");
    const stored = sampleResponse([27205]);
    await insertRecommendation(db, {
      sessionId,
      roundNumber: 1,
      aiResponse: stored,
      keptTmdbIds: [],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [27205],
    });

    await leaveGroup(db, "u2", "grp1");
    const response = await get(sessionId, "u2");

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.round).toBe(1);
    expect(body.response).toEqual(stored);
  });

  it("NEVER includes another member's rough_day — each member sees only their own flag", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db, {
      memberFlags: { u1: { roughDay: false }, u2: { roughDay: true } },
    });

    const bodyForU1 = await (await get(sessionId, "u1")).json<Record<string, any>>();
    const bodyForU2 = await (await get(sessionId, "u2")).json<Record<string, any>>();

    expect(bodyForU1.session.roughDay).toBe(false);
    expect(bodyForU2.session.roughDay).toBe(true);

    // Exactly one roughDay field in the whole payload (the requester's own),
    // and never the raw rough_day column name.
    const serialized = JSON.stringify(bodyForU1);
    expect(serialized.match(/roughDay/g)).toHaveLength(1);
    expect(serialized).not.toContain("rough_day");
  });

  it("never names a member who deleted their account, in the taste map or the prose", async () => {
    // The GET re-serves the stored ai_response verbatim, so the promise made at
    // the moment of deletion ("your name replaced by [deleted user]") is only
    // kept if the stored round itself was scrubbed.
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(db);
    await seedTitle(db, 27205, "Inception");

    const response = sampleResponse([27205]);
    response.tasteMap.members[0].summary = "Sam reaches for precise films.";
    response.tasteMap.overlap.summary = "Sam and Alex both like a heist.";
    response.recommendations[0].explanation = "A grief-shaped hole for Sam.";
    response.conversational = "Tonight leans toward Sam.";
    await insertRecommendation(db, {
      sessionId,
      roundNumber: 1,
      aiResponse: response,
      keptTmdbIds: [],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [27205],
    });

    await deleteAccount(db, "u1", () => {});

    const body = await (await get(sessionId, "u2")).json<Record<string, any>>();
    expect(JSON.stringify(body)).not.toContain("Sam");
    expect(body.response.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(body.response.conversational).toBe(`Tonight leans toward ${DELETED_USER_LABEL}.`);
    // The survivor's own record is untouched.
    expect(body.response.tasteMap.members[1].name).toBe("Alex");
  });

  it("reads only the round columns it serves", async () => {
    // candidate_snapshot holds the whole ~200-title pool the round was chosen
    // from and reaches no response field; every reload would carry it over the
    // wire from D1 for nothing (dev/reports/2026-08-01-performance-audit.md).
    const base = createFakeD1(loadMigration());
    const { db, statements } = recordStatements(base);
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setupSession(base);
    await seedTitle(base, 27205, "Inception");
    await insertRecommendation(base, {
      sessionId,
      roundNumber: 1,
      aiResponse: sampleResponse([27205]),
      keptTmdbIds: [],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [27205],
    });

    expect((await get(sessionId, "u1")).status).toBe(200);

    const read = statements.find((statement) => statement.sql.includes("FROM recommendations"));
    expect(read).toBeDefined();
    const columns = read!.sql.slice("SELECT ".length, read!.sql.indexOf(" FROM"));
    expect(columns.split(", ")).toEqual(["round_number", "ai_response"]);
  });
});
