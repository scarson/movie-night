// ABOUTME: Tests for movie-session lifecycle — solo-group-on-demand, session creation with
// ABOUTME: member-flag authorization, round counting, removed-id accumulation, rough-day privacy.

import { describe, it, expect } from "vitest";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { SOLO_GROUP_NAME } from "@/lib/groups";
import {
  createSoloGroup,
  createMovieSession,
  getRoundNumber,
  getAccumulatedRemovedIds,
  countMatchesThisMonth,
  getSessionForMember,
  getSessionMembersWithProfiles,
  getTitlesMap,
  formatTitleRefs,
  insertRecommendation,
  NotGroupMemberError,
} from "./movie-sessions";

function seedUser(db: D1Database, id: string, name: string) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, name, "2026-01-01T00:00:00.000Z")
    .run();
}

async function seedGroupWithMembers(db: D1Database, groupId: string, memberIds: string[]) {
  await db
    .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(groupId, "Test Group", `code-${groupId}`, "2026-01-01T00:00:00.000Z")
    .run();
  for (const userId of memberIds) {
    await db
      .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), groupId, userId, "2026-01-01T00:00:00.000Z")
      .run();
  }
}

function seedProfile(db: D1Database, userId: string, fields: Partial<Record<string, string>> = {}) {
  return db
    .prepare(
      `INSERT INTO profiles (user_id, comfort_titles, watchlist, vibes, dealbreakers, streaming_services, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      fields.comfort_titles ?? "[27205]",
      fields.watchlist ?? "[155]",
      fields.vibes ?? '["Cozy"]',
      fields.dealbreakers ?? '["Horror"]',
      fields.streaming_services ?? '["Netflix"]',
      "2026-01-01T00:00:00.000Z"
    )
    .run();
}

function seedRecommendation(
  db: D1Database,
  sessionId: string,
  round: number,
  opts: { removedIds?: number[]; createdAt?: string } = {}
) {
  return db
    .prepare(
      `INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids, removed_tmdb_ids,
         steering_feedback, model, prompt_version, candidate_snapshot, created_at)
       VALUES (?, ?, ?, ?, '[]', ?, '', 'm', 'p', '[]', ?)`
    )
    .bind(
      crypto.randomUUID(),
      sessionId,
      round,
      '{"ok":true}',
      JSON.stringify(opts.removedIds ?? []),
      opts.createdAt ?? new Date().toISOString()
    )
    .run();
}

function seedTitle(db: D1Database, tmdbId: number, title: string, opts: { lastRefreshedAt?: string | null } = {}) {
  return db
    .prepare(
      `INSERT INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path, popularity, streaming, last_refreshed_at, created_at)
       VALUES (?, 'movie', ?, 2020, '["Drama"]', 'Synopsis.', '/p.jpg', 50, '{"flatrate":["Netflix"]}', ?, '2026-01-01T00:00:00.000Z')`
    )
    .bind(tmdbId, title, opts.lastRefreshedAt === undefined ? "2026-07-01T00:00:00.000Z" : opts.lastRefreshedAt)
    .run();
}

async function newSession(
  db: D1Database,
  overrides: Partial<Parameters<typeof createMovieSession>[1]> = {}
): Promise<string> {
  const { sessionId } = await createMovieSession(db, {
    userId: "u1",
    groupId: "grp1",
    moodVibes: ["Cozy"],
    moodText: "",
    discoverNew: false,
    isQuickMatch: false,
    roughDay: false,
    ...overrides,
  });
  return sessionId;
}

describe("createSoloGroup", () => {
  it("creates a __solo__ group with the user as its only member", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const groupId = await createSoloGroup(db, "u1");

    const group = await db
      .prepare("SELECT * FROM groups WHERE id = ?")
      .bind(groupId)
      .first<{ name: string; invite_code: string }>();
    expect(group?.name).toBe(SOLO_GROUP_NAME);
    // Solo invite codes must never look like a joinable 8-char code.
    expect(group?.invite_code).not.toMatch(/^[2-9A-Za-z]{8}$/);

    const { results: members } = await db
      .prepare("SELECT user_id FROM group_members WHERE group_id = ?")
      .bind(groupId)
      .all<{ user_id: string }>();
    expect(members.map((m) => m.user_id)).toEqual(["u1"]);
  });

  it("reuses the existing solo group on subsequent calls", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const first = await createSoloGroup(db, "u1");
    const second = await createSoloGroup(db, "u1");

    expect(second).toBe(first);
    const { results } = await db
      .prepare("SELECT id FROM groups WHERE name = ?")
      .bind(SOLO_GROUP_NAME)
      .all();
    expect(results).toHaveLength(1);
  });

  it("gives each user their own solo group", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");

    const g1 = await createSoloGroup(db, "u1");
    const g2 = await createSoloGroup(db, "u2");

    expect(g1).not.toBe(g2);
  });
});

describe("createMovieSession", () => {
  it("creates the session plus a session_members row for EVERY group member", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    const sessionId = await newSession(db, { moodVibes: ["Cozy", "Funny"], moodText: "long week" });

    const session = await db
      .prepare("SELECT * FROM movie_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ group_id: string; initiated_by_user_id: string; mood_vibes: string; mood_text: string }>();
    expect(session?.group_id).toBe("grp1");
    expect(session?.initiated_by_user_id).toBe("u1");
    expect(JSON.parse(session!.mood_vibes)).toEqual(["Cozy", "Funny"]);
    expect(session?.mood_text).toBe("long week");

    const { results: members } = await db
      .prepare("SELECT user_id, rough_day FROM session_members WHERE session_id = ? ORDER BY user_id")
      .bind(sessionId)
      .all<{ user_id: string; rough_day: number }>();
    expect(members).toEqual([
      { user_id: "u1", rough_day: 0 },
      { user_id: "u2", rough_day: 0 },
    ]);
  });

  it("applies roughDay to the CALLING member's row only", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    const sessionId = await newSession(db, { roughDay: true });

    const { results } = await db
      .prepare("SELECT user_id, rough_day FROM session_members WHERE session_id = ? ORDER BY user_id")
      .bind(sessionId)
      .all<{ user_id: string; rough_day: number }>();
    expect(results).toEqual([
      { user_id: "u1", rough_day: 1 },
      { user_id: "u2", rough_day: 0 },
    ]);
  });

  it("lets memberFlags set other members' flags and win over roughDay for the caller", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    const sessionId = await newSession(db, {
      roughDay: true,
      memberFlags: { u1: { roughDay: false }, u2: { roughDay: true } },
    });

    const { results } = await db
      .prepare("SELECT user_id, rough_day FROM session_members WHERE session_id = ? ORDER BY user_id")
      .bind(sessionId)
      .all<{ user_id: string; rough_day: number }>();
    expect(results).toEqual([
      { user_id: "u1", rough_day: 0 },
      { user_id: "u2", rough_day: 1 },
    ]);
  });

  it("rejects a non-member caller unconditionally (no memberFlags involved)", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "outsider", "Mallory");
    await seedGroupWithMembers(db, "grp1", ["u1"]);

    await expect(newSession(db, { userId: "outsider" })).rejects.toBeInstanceOf(NotGroupMemberError);
    const { results } = await db.prepare("SELECT * FROM movie_sessions").all();
    expect(results).toHaveLength(0);
  });

  it("rejects an unknown group id", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    await expect(newSession(db, { groupId: "nope" })).rejects.toBeInstanceOf(NotGroupMemberError);
  });

  it("rejects memberFlags whose keys are not members of the group", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedUser(db, "outsider", "Mallory");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    await expect(
      newSession(db, { memberFlags: { outsider: { roughDay: true } } })
    ).rejects.toBeInstanceOf(NotGroupMemberError);
    const { results } = await db.prepare("SELECT * FROM movie_sessions").all();
    expect(results).toHaveLength(0);
  });

  it("creates a solo session via the on-demand personal group when groupId is null", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const sessionId = await newSession(db, { groupId: null, isQuickMatch: true });

    const session = await db
      .prepare("SELECT group_id, is_quick_match FROM movie_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ group_id: string; is_quick_match: number }>();
    const group = await db
      .prepare("SELECT name FROM groups WHERE id = ?")
      .bind(session!.group_id)
      .first<{ name: string }>();
    expect(group?.name).toBe(SOLO_GROUP_NAME);
    expect(session?.is_quick_match).toBe(1);

    // A second solo session reuses the same personal group.
    const sessionId2 = await newSession(db, { groupId: null });
    const session2 = await db
      .prepare("SELECT group_id FROM movie_sessions WHERE id = ?")
      .bind(sessionId2)
      .first<{ group_id: string }>();
    expect(session2?.group_id).toBe(session!.group_id);
  });
});

describe("round counting and accumulation", () => {
  it("getRoundNumber returns 1 for a fresh session and count+1 afterwards", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    expect(await getRoundNumber(db, sessionId)).toBe(1);
    await seedRecommendation(db, sessionId, 1);
    await seedRecommendation(db, sessionId, 2);
    expect(await getRoundNumber(db, sessionId)).toBe(3);
  });

  it("getAccumulatedRemovedIds unions removed ids across all prior rounds, deduped", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    const otherSession = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { removedIds: [1, 2] });
    await seedRecommendation(db, sessionId, 2, { removedIds: [2, 3] });
    await seedRecommendation(db, otherSession, 1, { removedIds: [99] });

    const ids = await getAccumulatedRemovedIds(db, sessionId);
    expect([...ids].sort()).toEqual([1, 2, 3]);
  });

  it("countMatchesThisMonth counts only rows created since the start of the current month", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { createdAt: "2020-01-15T00:00:00.000Z" });
    expect(await countMatchesThisMonth(db)).toBe(0);

    await seedRecommendation(db, sessionId, 2, { createdAt: new Date().toISOString() });
    expect(await countMatchesThisMonth(db)).toBe(1);
  });
});

describe("getSessionForMember (rough-day privacy)", () => {
  it("returns the session view with ONLY the requesting member's own roughDay", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
    const sessionId = await newSession(db, { roughDay: true, moodVibes: ["Cozy"] });

    const viewForU1 = await getSessionForMember(db, sessionId, "u1");
    const viewForU2 = await getSessionForMember(db, sessionId, "u2");

    expect(viewForU1).toMatchObject({
      id: sessionId,
      groupId: "grp1",
      moodVibes: ["Cozy"],
      discoverNew: false,
      isQuickMatch: false,
      solo: false,
      roughDay: true,
    });
    expect(viewForU2?.roughDay).toBe(false);

    // The serialized view must never carry any other member's flag.
    const keys = Object.keys(viewForU1!);
    expect(keys).not.toContain("members");
    expect(JSON.stringify(viewForU1)).not.toContain("rough_day");
  });

  it("returns null for non-members and for unknown sessions (indistinguishable)", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "outsider", "Mallory");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    expect(await getSessionForMember(db, sessionId, "outsider")).toBeNull();
    expect(await getSessionForMember(db, "no-such-session", "u1")).toBeNull();
  });

  it("marks solo sessions as solo", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    const sessionId = await newSession(db, { groupId: null });

    const view = await getSessionForMember(db, sessionId, "u1");
    expect(view?.solo).toBe(true);
  });
});

describe("getSessionMembersWithProfiles", () => {
  it("joins names, flags, and parsed profiles; missing profiles become empty defaults", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
    await seedProfile(db, "u1");
    const sessionId = await newSession(db, { roughDay: true });

    const members = await getSessionMembersWithProfiles(db, sessionId);
    const byId = new Map(members.map((m) => [m.userId, m]));

    expect(byId.get("u1")).toEqual({
      userId: "u1",
      name: "Sam",
      roughDay: true,
      comfortTitles: [27205],
      watchlist: [155],
      vibes: ["Cozy"],
      dealbreakers: ["Horror"],
      streamingServices: ["Netflix"],
    });
    expect(byId.get("u2")).toEqual({
      userId: "u2",
      name: "Alex",
      roughDay: false,
      comfortTitles: [],
      watchlist: [],
      vibes: [],
      dealbreakers: [],
      streamingServices: [],
    });
  });

  it("skips session members whose user row no longer exists (deleted accounts)", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    await db
      .prepare("INSERT INTO session_members (id, session_id, user_id, rough_day) VALUES (?, ?, 'deleted-abc123', 0)")
      .bind(crypto.randomUUID(), sessionId)
      .run();

    const members = await getSessionMembersWithProfiles(db, sessionId);
    expect(members.map((m) => m.userId)).toEqual(["u1"]);
  });
});

describe("titles helpers", () => {
  it("getTitlesMap returns parsed genres/streaming plus poster and lastRefreshedAt", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, 27205, "Inception");
    await seedTitle(db, 155, "The Dark Knight", { lastRefreshedAt: null });

    const map = await getTitlesMap(db, [27205, 155, 999]);

    expect(map[27205]).toEqual({
      title: "Inception",
      year: 2020,
      posterPath: "/p.jpg",
      genres: ["Drama"],
      streaming: { flatrate: ["Netflix"] },
      lastRefreshedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(map[155].lastRefreshedAt).toBeNull();
    expect(map[999]).toBeUndefined();
  });

  it("getTitlesMap returns an empty object for no ids", async () => {
    const db = createFakeD1(loadMigration());
    expect(await getTitlesMap(db, [])).toEqual({});
  });

  it("formatTitleRefs renders 'Title (tmdbId N)' and skips unknown ids", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, 27205, "Inception");

    expect(await formatTitleRefs(db, [27205, 999])).toEqual(["Inception (tmdbId 27205)"]);
  });
});

describe("insertRecommendation", () => {
  it("persists the full row including model, prompt version, and candidate snapshot", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await insertRecommendation(db, {
      sessionId,
      roundNumber: 2,
      aiResponse: { ok: true } as never,
      keptTmdbIds: [1],
      removedTmdbIds: [2, 3],
      steeringFeedback: "less gloomy",
      candidateSnapshot: [1, 2, 3],
    });

    const row = await db
      .prepare("SELECT * FROM recommendations WHERE session_id = ?")
      .bind(sessionId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      round_number: 2,
      ai_response: '{"ok":true}',
      kept_tmdb_ids: "[1]",
      removed_tmdb_ids: "[2,3]",
      steering_feedback: "less gloomy",
      model: "claude-sonnet-5",
      prompt_version: "p1.0",
      candidate_snapshot: "[1,2,3]",
    });
    expect(typeof row?.created_at).toBe("string");
  });
});
