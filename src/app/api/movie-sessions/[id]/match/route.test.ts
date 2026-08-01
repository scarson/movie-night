// ABOUTME: Tests for POST /api/movie-sessions/[id]/match — round/monthly caps, validation,
// ABOUTME: the full engine flow against a mocked Anthropic client, and the error taxonomy contract.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Anthropic, { APIError, APIConnectionError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { createFakeD1, loadMigration, withFailingStatement, injectedFailureCount } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { createMovieSession, insertRecommendation } from "@/lib/movie-sessions";
import { leaveGroup } from "@/lib/groups";
import { PROMPT_VERSION } from "@/lib/matching";
import type { MatchingResponse } from "@/types/matching";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Mock ONLY the Anthropic client class (the network boundary). Error classes
// and everything else stay real so instanceof checks keep working.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  return { ...actual, default: vi.fn() };
});

const JWT_SECRET = "test-jwt-secret";

function fakeEnv(db: D1Database, monthlyLimit?: string): CloudflareEnv {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    JWT_SECRET,
    ANTHROPIC_API_KEY: "test-anthropic-key",
    TMDB_API_TOKEN: "test-tmdb-token",
    ...(monthlyLimit !== undefined ? { MONTHLY_MATCH_LIMIT: monthlyLimit } : {}),
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

function seedTitle(db: D1Database, tmdbId: number, title: string, popularity = 50) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path, popularity, streaming, last_refreshed_at, created_at)
       VALUES (?, 'movie', ?, 2020, '["Drama"]', 'Synopsis.', '/p.jpg', ?, '{"flatrate":["Netflix"]}', '2026-07-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
    .bind(tmdbId, title, popularity)
    .run();
}

const FIVE_TITLES: Array<[number, string]> = [
  [27205, "Inception"],
  [155, "The Dark Knight"],
  [603, "The Matrix"],
  [550, "Fight Club"],
  [680, "Pulp Fiction"],
];

async function setup(db: D1Database): Promise<string> {
  await seedUser(db, "u1", "Sam");
  await seedUser(db, "u2", "Alex");
  await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
  for (const [id, title, pop] of FIVE_TITLES.map(([id, t], i) => [id, t, 100 - i] as [number, string, number])) {
    await seedTitle(db, id, title, pop);
  }
  const { sessionId } = await createMovieSession(db, {
    userId: "u1",
    groupId: "grp1",
    moodVibes: ["Cozy"],
    moodText: "",
    discoverNew: false,
    isQuickMatch: false,
    roughDay: false,
  });
  return sessionId;
}

function validResponse(tmdbIds: number[]): MatchingResponse {
  return {
    tasteMap: {
      members: [
        { userId: "u1", name: "Sam", summary: "s", primaryVibes: ["Cozy"], genreAffinities: ["Drama"] },
        { userId: "u2", name: "Alex", summary: "s", primaryVibes: ["Funny"], genreAffinities: ["Comedy"] },
      ],
      overlap: { summary: "o", sharedVibes: [], tensionPoints: [] },
    },
    recommendations: tmdbIds.map((id) => ({ tmdbId: id, matchScore: 90, explanation: "e" })),
    conversational: "Try **Inception**.",
  };
}

/** Leading thinking block included deliberately — the engine must find() the text block. */
function apiMessage(text: string, stopReason = "end_turn"): Message {
  return {
    content: [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text },
    ],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 200 },
  } as unknown as Message;
}

type CreateStub = ReturnType<typeof vi.fn>;

function stubAnthropic(outcomes: Array<Message | Error>): CreateStub {
  let call = 0;
  const create = vi.fn(async (params: unknown) => {
    void params;
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call++;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  // Must be a `function` (not an arrow) so `new Anthropic(...)` can construct it.
  vi.mocked(Anthropic).mockImplementation(function (this: unknown) {
    return { messages: { create } } as unknown as Anthropic;
  } as never);
  return create;
}

async function postMatch(sessionId: string, userId: string, body: unknown = {}): Promise<Response> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const { POST } = await import("./route");
  return POST(
    new NextRequest(`https://example.com/api/movie-sessions/${sessionId}/match`, {
      method: "POST",
      headers: { cookie: `mn-session=${jwt}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) }
  );
}

describe("POST /api/movie-sessions/[id]/match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/movie-sessions/s1/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-members and unknown sessions, without calling the model", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    await seedUser(db, "outsider", "Mallory");
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

    expect((await postMatch(sessionId, "outsider")).status).toBe(404);
    expect((await postMatch("no-such-session", "u1")).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid bodies (bad JSON, non-int ids, oversized lists, 10k-char steering)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

    expect((await postMatch(sessionId, "u1", "broken{{{")).status).toBe(400);
    expect((await postMatch(sessionId, "u1", "null")).status).toBe(400);
    expect((await postMatch(sessionId, "u1", { keptTmdbIds: ["27205"] })).status).toBe(400);
    expect((await postMatch(sessionId, "u1", { removedTmdbIds: [1.5] })).status).toBe(400);
    expect(
      (await postMatch(sessionId, "u1", { keptTmdbIds: Array.from({ length: 51 }, (_, i) => i) })).status
    ).toBe(400);
    expect(
      (await postMatch(sessionId, "u1", { steeringFeedback: "s".repeat(10_000) })).status
    ).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts an exactly-300-char steeringFeedback (boundary)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1", { steeringFeedback: "s".repeat(300) });
    logSpy.mockRestore();

    expect(response.status).toBe(200);
  });

  it("runs the engine and returns { round, response, titles } with hydrated titles incl. lastRefreshedAt", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    const engineResponse = validResponse([27205, 155, 603]);
    const create = stubAnthropic([apiMessage(JSON.stringify(engineResponse))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1");

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.round).toBe(1);
    expect(body.response).toEqual(engineResponse);
    expect(Object.keys(body.titles).map(Number).sort((a, b) => a - b)).toEqual([155, 603, 27205]);
    expect(body.titles[27205]).toEqual({
      title: "Inception",
      year: 2020,
      posterPath: "/p.jpg",
      genres: ["Drama"],
      streaming: { flatrate: ["Netflix"] },
      lastRefreshedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(create).toHaveBeenCalledTimes(1);

    // The matching_call structured log line was emitted (default logger).
    const matchingLines = logSpy.mock.calls.filter(([line]) =>
      typeof line === "string" && line.includes('"event":"matching_call"')
    );
    expect(matchingLines).toHaveLength(1);
    logSpy.mockRestore();

    // The round row is persisted with the model + prompt version + snapshot.
    const row = await db
      .prepare("SELECT * FROM recommendations WHERE session_id = ?")
      .bind(sessionId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      round_number: 1,
      model: "claude-sonnet-5",
      prompt_version: "p1.1",
    });
    expect(JSON.parse(row!.candidate_snapshot as string).sort((a: number, b: number) => a - b)).toEqual(
      [155, 550, 603, 680, 27205]
    );
    expect(JSON.parse(row!.ai_response as string)).toEqual(engineResponse);
  });

  it("accumulates removed ids across rounds and passes kept/removed titles to the prompt", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    await insertRecommendation(db, {
      sessionId,
      roundNumber: 1,
      aiResponse: validResponse([27205, 155, 603]),
      keptTmdbIds: [],
      removedTmdbIds: [155],
      steeringFeedback: "",
      candidateSnapshot: [27205, 155, 603],
    });
    // 155 and 603 are excluded from the pool, so the model can only name the
    // three titles that survive the removal filter.
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 550, 680])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // 603 and 27205 both appeared in round 1's recommendations, so they are ids
    // this client could really have kept or rejected.
    const response = await postMatch(sessionId, "u1", {
      keptTmdbIds: [27205],
      removedTmdbIds: [603],
      steeringFeedback: "less gloomy",
    });
    logSpy.mockRestore();

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.round).toBe(2);

    const params = create.mock.calls[0][0] as { system: string };
    expect(params.system).toContain("Inception (tmdbId 27205)");
    // Removed list = prior round's 155 plus this round's 603, by title.
    expect(params.system).toContain("The Dark Knight (tmdbId 155)");
    expect(params.system).toContain("The Matrix (tmdbId 603)");
    expect(params.system).toContain(
      "Their feedback on the previous recommendations (verbatim, one line): less gloomy"
    );

    const row = await db
      .prepare("SELECT removed_tmdb_ids, kept_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 2")
      .bind(sessionId)
      .first<{ removed_tmdb_ids: string; kept_tmdb_ids: string }>();
    expect(JSON.parse(row!.removed_tmdb_ids)).toEqual([603]);
    expect(JSON.parse(row!.kept_tmdb_ids)).toEqual([27205]);
  });

  it("rejects round 11 with 429 round_limit and the locked message, without calling the model", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    for (let round = 1; round <= 10; round++) {
      await insertRecommendation(db, {
        sessionId,
        roundNumber: round,
        aiResponse: validResponse([27205, 155, 603]),
        keptTmdbIds: [],
        removedTmdbIds: [],
        steeringFeedback: "",
        candidateSnapshot: [],
      });
    }
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

    const response = await postMatch(sessionId, "u1");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "You've hit tonight's refinement limit",
      kind: "round_limit",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects with 429 monthly_cap when the monthly recommendation count hits MONTHLY_MATCH_LIMIT", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db, "1"), ctx: {} } as never);
    const sessionId = await setup(db);
    // One row this month, in a DIFFERENT session — the cap is global.
    const { sessionId: otherSession } = await createMovieSession(db, {
      userId: "u1",
      groupId: "grp1",
      moodVibes: [],
      moodText: "",
      discoverNew: false,
      isQuickMatch: false,
      roughDay: false,
    });
    await insertRecommendation(db, {
      sessionId: otherSession,
      roundNumber: 1,
      aiResponse: validResponse([27205, 155, 603]),
      keptTmdbIds: [],
      removedTmdbIds: [],
      steeringFeedback: "",
      candidateSnapshot: [],
    });
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

    const response = await postMatch(sessionId, "u1");
    expect(response.status).toBe(429);
    const body = await response.json<Record<string, string>>();
    expect(body.kind).toBe("monthly_cap");
    expect(create).not.toHaveBeenCalled();
  });

  describe("MONTHLY_MATCH_LIMIT parsing", () => {
    async function attempt(monthlyLimit?: string): Promise<Response> {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({
        env: fakeEnv(db, monthlyLimit),
        ctx: {},
      } as never);
      const sessionId = await setup(db);
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const response = await postMatch(sessionId, "u1");
      logSpy.mockRestore();
      return response;
    }

    it("0 disables matching outright — it is the kill switch, not a missing value", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db, "0"), ctx: {} } as never);
      const sessionId = await setup(db);
      const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

      const response = await postMatch(sessionId, "u1");

      expect(response.status).toBe(429);
      expect((await response.json<Record<string, string>>()).kind).toBe("monthly_cap");
      expect(create).not.toHaveBeenCalled();
      const { results } = await db
        .prepare("SELECT * FROM recommendations WHERE session_id = ?")
        .bind(sessionId)
        .all();
      expect(results).toHaveLength(0);
    });

    it("a negative limit falls back to the default rather than reading as unlimited", async () => {
      expect((await attempt("-1")).status).toBe(200);
    });

    it("a non-numeric limit falls back to the default", async () => {
      expect((await attempt("abc")).status).toBe(200);
    });

    it("an empty limit falls back to the default", async () => {
      expect((await attempt("")).status).toBe(200);
    });

    it("an absent limit falls back to the default", async () => {
      expect((await attempt()).status).toBe(200);
    });
  });

  it("maps a refusal (after one retry) to 502 kind malformed with the locked message", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    const create = stubAnthropic([apiMessage("", "refusal")]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1");
    logSpy.mockRestore();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Our movie brain got confused — try again",
      kind: "malformed",
    });
    expect(create).toHaveBeenCalledTimes(2); // retried once
  });

  it("maps thin results to 502 kind thin_results", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1");
    logSpy.mockRestore();

    expect(response.status).toBe(502);
    const body = await response.json<Record<string, string>>();
    expect(body.kind).toBe("thin_results");
  });

  it("maps connection errors to 503 timeout and 529/5xx to 503 overloaded", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);

    stubAnthropic([new APIConnectionError({ message: "down" })]);
    let response = await postMatch(sessionId, "u1");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Our movie brain is taking a nap — try again in a moment",
      kind: "timeout",
    });

    stubAnthropic([new APIError(529, { type: "error" }, "overloaded", new Headers())]);
    response = await postMatch(sessionId, "u1");
    expect(response.status).toBe(503);
    expect((await response.json<Record<string, string>>()).kind).toBe("overloaded");
  });

  it("maps an Anthropic 401 to 503 provider_auth without naming the credential", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    stubAnthropic([new APIError(401, { type: "error" }, "invalid x-api-key", new Headers())]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1");
    errorSpy.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Our movie brain is taking a nap — try again in a moment",
      kind: "provider_auth",
    });
    const { results } = await db
      .prepare("SELECT * FROM recommendations WHERE session_id = ?")
      .bind(sessionId)
      .all();
    expect(results).toHaveLength(0);
  });

  it("maps Anthropic 429 to 429 rate_limited with the locked message", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    stubAnthropic([new APIError(429, { type: "error" }, "rate limited", new Headers())]);

    const response = await postMatch(sessionId, "u1");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "We're getting a lot of requests right now, try again in a moment",
      kind: "rate_limited",
    });
  });

  it("failed rounds are not persisted (no recommendations row)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    stubAnthropic([new APIConnectionError({ message: "down" })]);

    await postMatch(sessionId, "u1");

    const { results } = await db
      .prepare("SELECT * FROM recommendations WHERE session_id = ?")
      .bind(sessionId)
      .all();
    expect(results).toHaveLength(0);
  });

  describe("group membership gates the spend path", () => {
    it("refuses a new round for someone who has left the group", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);

      await leaveGroup(db, "u2", "grp1");
      const response = await postMatch(sessionId, "u2");

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "You've left this group — you can still read this evening, but not run it again",
        kind: "left_group",
      });
      expect(create).not.toHaveBeenCalled();
      const { results } = await db
        .prepare("SELECT * FROM recommendations WHERE session_id = ?")
        .bind(sessionId)
        .all();
      expect(results).toHaveLength(0);
    });

    it("still lets a current member of the same group run a round", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await leaveGroup(db, "u2", "grp1");
      const response = await postMatch(sessionId, "u1");
      logSpy.mockRestore();

      expect(response.status).toBe(200);
    });

    it("lets a solo session's creator match — they always hold their own __solo__ membership", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      await seedUser(db, "u1", "Sam");
      for (const [id, title] of FIVE_TITLES) await seedTitle(db, id, title);
      const { sessionId } = await createMovieSession(db, {
        userId: "u1",
        groupId: null,
        moodVibes: [],
        moodText: "",
        discoverNew: false,
        isQuickMatch: true,
        roughDay: false,
      });
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const response = await postMatch(sessionId, "u1");
      logSpy.mockRestore();

      expect(response.status).toBe(200);
    });
  });

  it("keeps this round's removal in the prompt when the exclusion list overflows its cap", async () => {
    // Nine prior rounds carry 15 removals each — 135 accumulated ids, well past
    // the 100-entry prompt cap. The id removed on THIS request is the one a user
    // would notice coming back, so it is the one that must survive truncation,
    // and the earliest rounds are the ones that fall off.
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    // formatTitleRefs drops any id with no titles row, so the catalog must hold
    // every removed id or the list never reaches the cap.
    for (let id = 1; id <= 135; id++) await seedTitle(db, id, `Bulk ${id}`, 200 - id);
    await seedTitle(db, 500, "Just Rejected", 1000);
    for (const [id, title] of FIVE_TITLES) await seedTitle(db, id, title, 5);
    const { sessionId } = await createMovieSession(db, {
      userId: "u1",
      groupId: "grp1",
      moodVibes: [],
      moodText: "",
      discoverNew: false,
      isQuickMatch: false,
      roughDay: false,
    });
    for (let round = 1; round <= 9; round++) {
      await insertRecommendation(db, {
        sessionId,
        roundNumber: round,
        // Round 9 recommends 500, which is what makes removing it this round legitimate.
        aiResponse: validResponse(round === 9 ? [500, 27205, 155] : [27205, 155, 603]),
        keptTmdbIds: [],
        removedTmdbIds: Array.from({ length: 15 }, (_, i) => (round - 1) * 15 + i + 1),
        steeringFeedback: "",
        candidateSnapshot: [],
      });
    }
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1", { removedTmdbIds: [500] });
    logSpy.mockRestore();

    expect(response.status).toBe(200);
    const params = create.mock.calls[0][0] as { system: string };
    const exclusionLine = params.system.split("\n").find((l) => l.includes("Do NOT recommend"))!;
    expect(exclusionLine).toContain("Just Rejected (tmdbId 500)");
    // The cap bit: round 9's removals survive, rounds 1 and 2's are dropped.
    expect(exclusionLine).toContain("Bulk 135 (tmdbId 135)");
    expect(exclusionLine).not.toContain("Bulk 15 (tmdbId 15)");
    expect(exclusionLine).not.toContain("Bulk 30 (tmdbId 30)");
    expect(exclusionLine.split("(tmdbId ")).toHaveLength(101);
  });

  it("keeps removed titles out of the candidate pool the model is given", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const sessionId = await setup(db);
    await insertRecommendation(db, {
      sessionId,
      roundNumber: 1,
      aiResponse: validResponse([27205, 155, 603]),
      keptTmdbIds: [],
      removedTmdbIds: [155],
      steeringFeedback: "",
      candidateSnapshot: [27205, 155, 603],
    });
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 550, 680])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1", { removedTmdbIds: [603] });
    logSpy.mockRestore();

    expect(response.status).toBe(200);
    const params = create.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const candidateBlock = params.messages[0].content.split("CANDIDATES (recommend only from this list):")[1];
    expect(candidateBlock).not.toContain("155 | ");
    expect(candidateBlock).not.toContain("603 | ");
    expect(candidateBlock).toContain("27205 | ");
    // The persisted snapshot is the same filtered pool, so parseMatchingResponse
    // and any later audit agree on what the model was allowed to name.
    const row = await db
      .prepare("SELECT candidate_snapshot FROM recommendations WHERE session_id = ? AND round_number = 2")
      .bind(sessionId)
      .first<{ candidate_snapshot: string }>();
    expect(JSON.parse(row!.candidate_snapshot).sort((a: number, b: number) => a - b)).toEqual([550, 680, 27205]);
  });

  describe("removed/kept id provenance", () => {
    it("drops removed ids this session never recommended", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      await insertRecommendation(db, {
        sessionId,
        roundNumber: 1,
        aiResponse: validResponse([27205, 155, 603]),
        keptTmdbIds: [],
        removedTmdbIds: [],
        steeringFeedback: "",
        candidateSnapshot: [27205, 155, 603],
      });
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 603, 550])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const response = await postMatch(sessionId, "u1", { removedTmdbIds: [155, 999] });
      logSpy.mockRestore();

      expect(response.status).toBe(200);
      const row = await db
        .prepare("SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 2")
        .bind(sessionId)
        .first<{ removed_tmdb_ids: string }>();
      expect(JSON.parse(row!.removed_tmdb_ids)).toEqual([155]);
    });

    it("accepts no removals on round 1 — nothing has been shown yet", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const response = await postMatch(sessionId, "u1", { removedTmdbIds: [27205, 155] });
      logSpy.mockRestore();

      expect(response.status).toBe(200);
      const row = await db
        .prepare("SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 1")
        .bind(sessionId)
        .first<{ removed_tmdb_ids: string }>();
      expect(JSON.parse(row!.removed_tmdb_ids)).toEqual([]);
    });

    it("keeps removals of ids the session did recommend", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      await insertRecommendation(db, {
        sessionId,
        roundNumber: 1,
        aiResponse: validResponse([27205, 155, 603]),
        keptTmdbIds: [],
        removedTmdbIds: [],
        steeringFeedback: "",
        candidateSnapshot: [27205, 155, 603],
      });
      stubAnthropic([apiMessage(JSON.stringify(validResponse([550, 680, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await postMatch(sessionId, "u1", { removedTmdbIds: [27205, 155] });
      logSpy.mockRestore();

      const row = await db
        .prepare("SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 2")
        .bind(sessionId)
        .first<{ removed_tmdb_ids: string }>();
      expect(JSON.parse(row!.removed_tmdb_ids)).toEqual([27205, 155]);
    });

    it("filters keptTmdbIds the same way, so only shown titles reach the prompt", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      await insertRecommendation(db, {
        sessionId,
        roundNumber: 1,
        aiResponse: validResponse([27205]),
        keptTmdbIds: [],
        removedTmdbIds: [],
        steeringFeedback: "",
        candidateSnapshot: [27205],
      });
      const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await postMatch(sessionId, "u1", { keptTmdbIds: [27205, 680] });
      logSpy.mockRestore();

      const params = create.mock.calls[0][0] as { system: string };
      expect(params.system).toContain("Inception (tmdbId 27205)");
      expect(params.system).not.toContain("Pulp Fiction (tmdbId 680)");
      const row = await db
        .prepare("SELECT kept_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 2")
        .bind(sessionId)
        .first<{ kept_tmdb_ids: string }>();
      expect(JSON.parse(row!.kept_tmdb_ids)).toEqual([27205]);
    });

    it("logs a structured line naming how many ids were dropped", async () => {
      const db = createFakeD1(loadMigration());
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
      const sessionId = await setup(db);
      await insertRecommendation(db, {
        sessionId,
        roundNumber: 1,
        aiResponse: validResponse([27205, 155, 603]),
        keptTmdbIds: [],
        removedTmdbIds: [],
        steeringFeedback: "",
        candidateSnapshot: [27205, 155, 603],
      });
      stubAnthropic([apiMessage(JSON.stringify(validResponse([550, 680, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await postMatch(sessionId, "u1", { removedTmdbIds: [155, 999] });

      const filtered = logSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string" && line.includes("removed_ids_filtered"))
        .map((line) => JSON.parse(line));
      logSpy.mockRestore();

      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({
        event: "removed_ids_filtered",
        session_id: sessionId,
        submitted: 2,
        accepted: 1,
      });
    });
  });

  describe("a D1 failure after the billed call", () => {
    it("returns the paid round with an empty titles map when hydration fails", async () => {
      // Not a concurrency test: withFailingStatement makes one already-reached
      // statement throw, sequentially. The fixture's members have no comfort or
      // watchlist ids, so getTitlesMap short-circuits everywhere earlier in the
      // route and the trailing hydration is the first execution of this SQL.
      const db = createFakeD1(loadMigration());
      const sessionId = await setup(db);
      const failing = withFailingStatement(db, {
        match: "SELECT tmdb_id, title, year, poster_path, genres, streaming",
      });
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(failing), ctx: {} } as never);
      const engineResponse = validResponse([27205, 155, 603]);
      stubAnthropic([apiMessage(JSON.stringify(engineResponse))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await postMatch(sessionId, "u1");
      logSpy.mockRestore();
      errorSpy.mockRestore();

      expect(injectedFailureCount(failing)).toBe(1);
      expect(response.status).toBe(200);
      const body = await response.json<Record<string, any>>();
      expect(body.round).toBe(1);
      expect(body.response).toEqual(engineResponse);
      expect(body.titles).toEqual({});
      const { results } = await db
        .prepare("SELECT * FROM recommendations WHERE session_id = ?")
        .bind(sessionId)
        .all();
      expect(results).toHaveLength(1);
    });

    it("logs enough to re-run a round it could not persist, and no personal data", async () => {
      const db = createFakeD1(loadMigration());
      const sessionId = await setup(db);
      const failing = withFailingStatement(db, { match: "INSERT INTO recommendations" });
      vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(failing), ctx: {} } as never);
      stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await postMatch(sessionId, "u1");
      logSpy.mockRestore();
      const errorCalls = errorSpy.mock.calls;
      const errorOutput = errorCalls.map((args) => args.map(String).join(" ")).join("\n");
      const persistLine = errorCalls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string" && line.includes("round_persist_failed"))
        .map((line) => JSON.parse(line));
      errorSpy.mockRestore();

      expect(injectedFailureCount(failing)).toBe(1);
      expect(response.status).toBe(500);
      expect(persistLine).toHaveLength(1);
      expect(persistLine[0]).toMatchObject({
        event: "round_persist_failed",
        session_id: sessionId,
        round: 1,
        tmdb_ids: [27205, 155, 603],
        prompt_version: PROMPT_VERSION,
      });
      // Invocation logs are retained, and the response carries member names,
      // per-member taste summaries and the conversational write-up.
      expect(errorOutput).not.toContain("Try **Inception**");
      expect(errorOutput).not.toContain("Sam");
      expect(errorOutput).not.toContain("Alex");
    });
  });

  it("never leaks any member's rough-day flag in the match response", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
    for (const [id, title] of FIVE_TITLES) await seedTitle(db, id, title);
    const { sessionId } = await createMovieSession(db, {
      userId: "u1",
      groupId: "grp1",
      moodVibes: [],
      moodText: "",
      discoverNew: false,
      isQuickMatch: false,
      roughDay: false,
      memberFlags: { u2: { roughDay: true } },
    });
    stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 155, 603])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1");
    logSpy.mockRestore();

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("roughDay");
    expect(serialized).not.toContain("rough_day");
  });
});
