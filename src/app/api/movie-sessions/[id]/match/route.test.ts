// ABOUTME: Tests for POST /api/movie-sessions/[id]/match — round/monthly caps, validation,
// ABOUTME: the full engine flow against a mocked Anthropic client, and the error taxonomy contract.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import Anthropic, { APIError, APIConnectionError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { createMovieSession, insertRecommendation } from "@/lib/movie-sessions";
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
      prompt_version: "p1.0",
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
    const create = stubAnthropic([apiMessage(JSON.stringify(validResponse([27205, 603, 550])))]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await postMatch(sessionId, "u1", {
      keptTmdbIds: [27205],
      removedTmdbIds: [680],
      steeringFeedback: "less gloomy",
    });
    logSpy.mockRestore();

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.round).toBe(2);

    const params = create.mock.calls[0][0] as { system: string };
    expect(params.system).toContain("Inception (tmdbId 27205)");
    // Removed list = prior round's 155 plus this round's 680, by title.
    expect(params.system).toContain("The Dark Knight (tmdbId 155)");
    expect(params.system).toContain("Pulp Fiction (tmdbId 680)");
    expect(params.system).toContain('"less gloomy"');

    const row = await db
      .prepare("SELECT removed_tmdb_ids, kept_tmdb_ids FROM recommendations WHERE session_id = ? AND round_number = 2")
      .bind(sessionId)
      .first<{ removed_tmdb_ids: string; kept_tmdb_ids: string }>();
    expect(JSON.parse(row!.removed_tmdb_ids)).toEqual([680]);
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
