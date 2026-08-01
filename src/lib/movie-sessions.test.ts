// ABOUTME: Tests for movie-session lifecycle — solo-group-on-demand, session creation with
// ABOUTME: member-flag authorization, round counting, removed-id accumulation, rough-day privacy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { SOLO_GROUP_NAME, joinGroup } from "@/lib/groups";
import { deleteAccount } from "@/lib/account";
import {
  createSoloGroup,
  createMovieSession,
  getMatchRoundContext,
  getSessionForMember,
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

  it("derives the group id and invite code from the user, so a second insert has nothing new to claim", async () => {
    // The duplicate came from a per-call random id and a per-call random invite
    // code: two callers past the fast-path SELECT satisfied every constraint and
    // both succeeded. A per-user identity is what makes the insert idempotent.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const groupId = await createSoloGroup(db, "u1");

    expect(groupId).toBe("solo-u1");
    const group = await db
      .prepare("SELECT invite_code FROM groups WHERE id = ?")
      .bind(groupId)
      .first<{ invite_code: string }>();
    expect(group?.invite_code).toBe("solo-u1");
  });

  it("adopts an existing solo group whose membership row is missing instead of creating a second one", async () => {
    // This is where a losing racer lands: the group row is already there but the
    // fast-path SELECT, which joins group_members, does not see it. The three
    // statements are sequenced (not batched) precisely so this path can insert
    // the membership against a group row that is guaranteed to exist.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await db
      .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
      .bind("solo-u1", SOLO_GROUP_NAME, "solo-u1", "2026-01-01T00:00:00.000Z")
      .run();

    const groupId = await createSoloGroup(db, "u1");

    expect(groupId).toBe("solo-u1");
    const { results: groups } = await db
      .prepare("SELECT id FROM groups WHERE name = ?")
      .bind(SOLO_GROUP_NAME)
      .all();
    expect(groups).toHaveLength(1);
    const { results: members } = await db
      .prepare("SELECT user_id FROM group_members WHERE group_id = ?")
      .bind("solo-u1")
      .all<{ user_id: string }>();
    expect(members.map((m) => m.user_id)).toEqual(["u1"]);
  });

  it("creates exactly one group and one membership when called repeatedly", async () => {
    // REPEATED, not concurrent. src/test/fake-d1.ts is backed by node:sqlite's
    // synchronous DatabaseSync and cannot interleave two callers, so the actual
    // race remains unprovable here — see docs/pitfalls/testing-pitfalls.md §5.
    // What this pins is the property the fix rests on: the second call has
    // nothing left to insert.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const first = await createSoloGroup(db, "u1");
    const second = await createSoloGroup(db, "u1");
    const third = await createSoloGroup(db, "u1");

    expect(second).toBe(first);
    expect(third).toBe(first);
    const groups = await db
      .prepare("SELECT COUNT(*) as count FROM groups WHERE name = ?")
      .bind(SOLO_GROUP_NAME)
      .first<{ count: number }>();
    expect(groups?.count).toBe(1);
    const members = await db
      .prepare("SELECT COUNT(*) as count FROM group_members WHERE user_id = ?")
      .bind("u1")
      .first<{ count: number }>();
    expect(members?.count).toBe(1);
  });

  it("reuses a pre-existing solo group that still has a random id", async () => {
    // Solo groups created before the id became deterministic must keep working:
    // the fast-path SELECT is what makes that true.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    const legacyId = crypto.randomUUID();
    await db
      .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
      .bind(legacyId, SOLO_GROUP_NAME, `solo-${crypto.randomUUID()}`, "2026-01-01T00:00:00.000Z")
      .run();
    await db
      .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), legacyId, "u1", "2026-01-01T00:00:00.000Z")
      .run();

    expect(await createSoloGroup(db, "u1")).toBe(legacyId);
    const { results } = await db
      .prepare("SELECT id FROM groups WHERE name = ?")
      .bind(SOLO_GROUP_NAME)
      .all();
    expect(results).toHaveLength(1);
  });

  it("leaves a solo group unjoinable even though its invite code is now guessable", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await createSoloGroup(db, "u1");

    expect(await joinGroup(db, "u2", "solo-u1")).toBeNull();
    const { results } = await db
      .prepare("SELECT user_id FROM group_members WHERE group_id = ?")
      .bind("solo-u1")
      .all<{ user_id: string }>();
    expect(results.map((m) => m.user_id)).toEqual(["u1"]);
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
  it("reports round 1 for a fresh session and count+1 afterwards", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    expect((await getMatchRoundContext(db, sessionId)).round).toBe(1);
    await seedRecommendation(db, sessionId, 1);
    await seedRecommendation(db, sessionId, 2);
    expect((await getMatchRoundContext(db, sessionId)).round).toBe(3);
  });

  it("unions removed ids across all prior rounds, deduped", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    const otherSession = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { removedIds: [1, 2] });
    await seedRecommendation(db, sessionId, 2, { removedIds: [2, 3] });
    await seedRecommendation(db, otherSession, 1, { removedIds: [99] });

    const ids = (await getMatchRoundContext(db, sessionId)).accumulatedRemovedIds;
    expect([...ids].sort()).toEqual([1, 2, 3]);
  });

  it("returns the newest round's removed ids first", async () => {
    // The prompt's exclusion list is capped, and the entries worth keeping are
    // the most recent rejections. Order is the mechanism that decides that, so
    // it is asserted as an exact sequence rather than as a set.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { removedIds: [10, 11] });
    await seedRecommendation(db, sessionId, 2, { removedIds: [20, 21] });
    await seedRecommendation(db, sessionId, 3, { removedIds: [30, 31] });

    expect((await getMatchRoundContext(db, sessionId)).accumulatedRemovedIds).toEqual([30, 31, 20, 21, 10, 11]);
  });

  it("counts only matches created since the start of the current month", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { createdAt: "2020-01-15T00:00:00.000Z" });
    expect((await getMatchRoundContext(db, sessionId)).matchesThisMonth).toBe(0);

    await seedRecommendation(db, sessionId, 2, { createdAt: new Date().toISOString() });
    expect((await getMatchRoundContext(db, sessionId)).matchesThisMonth).toBe(1);
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

  it("marks a one-member regular group as solo (member count, not group name)", async () => {
    // A user who creates a named group and starts a session before their
    // partner joins has a single-member group. Solo must be detected from the
    // member count — matching the client and CLAUDE.md — so the prompt never
    // asks the model to find overlap or tension for a group of one.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp-solo1", ["u1"]);
    const sessionId = await newSession(db, { groupId: "grp-solo1" });

    const view = await getSessionForMember(db, sessionId, "u1");
    expect(view?.solo).toBe(true);
  });

  it("marks a two-member group session as not solo", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp2", ["u1", "u2"]);
    const sessionId = await newSession(db, { groupId: "grp2" });

    const view = await getSessionForMember(db, sessionId, "u1");
    expect(view?.solo).toBe(false);
  });

  it("reports solo once the session's other member has deleted their account", async () => {
    // deleteAccount anonymizes session_members rather than deleting the row, so
    // a raw COUNT(*) still counts the departed member while the prompt does not.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp2", ["u1", "u2"]);
    const sessionId = await newSession(db, { groupId: "grp2" });

    await deleteAccount(db, "u2", () => {});

    const view = await getSessionForMember(db, sessionId, "u1");
    const members = (await getMatchRoundContext(db, sessionId)).members;
    // Asserting the two against each other is the point: the bug was that the
    // view said "not solo" while exactly one member reached the model.
    expect(view?.solo).toBe(members.length < 2);
    expect(view?.solo).toBe(true);
    expect(members).toHaveLength(1);
  });
});

describe("session members with profiles", () => {
  it("joins names, flags, and parsed profiles; missing profiles become empty defaults", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);
    await seedProfile(db, "u1");
    const sessionId = await newSession(db, { roughDay: true });

    const members = (await getMatchRoundContext(db, sessionId)).members;
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

    const members = (await getMatchRoundContext(db, sessionId)).members;
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

  it("getTitlesMap handles more ids than D1's bound-parameter limit", async () => {
    // A two-member group can union up to 200 comfort/watchlist ids, past D1's
    // 100-parameter ceiling. The map must chunk rather than bind them all at once.
    const db = createFakeD1(loadMigration());
    const ids = Array.from({ length: 150 }, (_, i) => 1000 + i);
    for (const id of ids) await seedTitle(db, id, `Title ${id}`);

    const map = await getTitlesMap(db, ids);

    expect(Object.keys(map)).toHaveLength(150);
    expect(map[1000].title).toBe("Title 1000");
    expect(map[1149].title).toBe("Title 1149");
  });

  it("formatTitleRefs renders 'Title (tmdbId N)' and skips unknown ids", async () => {
    const db = createFakeD1(loadMigration());
    await seedTitle(db, 27205, "Inception");

    expect(formatTitleRefs(await getTitlesMap(db, [27205]), [27205, 999])).toEqual([
      "Inception (tmdbId 27205)",
    ]);
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
      prompt_version: "p1.1",
      candidate_snapshot: "[1,2,3]",
    });
    expect(typeof row?.created_at).toBe("string");
  });
});

describe("recommendation indexes", () => {
  // loadMigration() reads the initial schema; the index migration is applied on
  // top of it explicitly here. Every statement in that file is IF [NOT] EXISTS,
  // so applying it a second time is a no-op and this stays correct whatever
  // loadMigration() reads.
  function indexMigration(): string {
    return readFileSync(
      join(process.cwd(), "migrations/0004_recommendation_indexes.sql"),
      "utf-8"
    );
  }

  function schemaWithIndexes(): string {
    return `${loadMigration()}\n${indexMigration()}`;
  }

  async function indexNames(db: D1Database): Promise<string[]> {
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all<{ name: string }>();
    return results.map((row) => row.name);
  }

  it("adds the created_at and (session_id, round_number) indexes", async () => {
    const names = await indexNames(createFakeD1(schemaWithIndexes()));
    expect(names).toContain("idx_recommendations_created_at");
    expect(names).toContain("idx_recommendations_session_round");
  });

  it("drops the superseded session index and the unused movie_sessions one", async () => {
    const names = await indexNames(createFakeD1(schemaWithIndexes()));
    expect(names).not.toContain("idx_recommendations_session");
    expect(names).not.toContain("idx_movie_sessions_group");
  });

  it("re-applying the migration is a no-op rather than an error", async () => {
    const names = await indexNames(createFakeD1(`${schemaWithIndexes()}\n${indexMigration()}`));
    expect(names).toContain("idx_recommendations_created_at");
    expect(names).toContain("idx_recommendations_session_round");
    // The half a botched second run would break: the drops must stay dropped,
    // not be resurrected by the initial schema being replayed alongside them.
    expect(names).not.toContain("idx_recommendations_session");
    expect(names).not.toContain("idx_movie_sessions_group");
  });

  // A DROP INDEX must not be able to change an answer. These two read through
  // the replaced index, so if the composite is wrong they fail.
  it("still counts every round of the session", async () => {
    const db = createFakeD1(schemaWithIndexes());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    const otherSession = await newSession(db);

    await seedRecommendation(db, sessionId, 1);
    await seedRecommendation(db, sessionId, 2);
    await seedRecommendation(db, sessionId, 3);
    await seedRecommendation(db, otherSession, 1);

    expect((await getMatchRoundContext(db, sessionId)).round).toBe(4);
    expect((await getMatchRoundContext(db, otherSession)).round).toBe(2);
  });

  // This copies the results route's query rather than calling it (the route needs
  // a full authenticated request). It therefore proves the *query shape* still
  // resolves against the replaced index — not that the route does. If that
  // route's query changes, this copy must change with it or it stops covering
  // anything; the column list is pinned by that route's own test, which asserts
  // the recorded SQL selects round_number and ai_response and nothing else.
  it("the latest-round query shape still selects the highest round of that session", async () => {
    const db = createFakeD1(schemaWithIndexes());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    const otherSession = await newSession(db);

    // Inserted out of order so a lookup that returns insertion order fails.
    await seedRecommendation(db, sessionId, 2);
    await seedRecommendation(db, sessionId, 3);
    await seedRecommendation(db, sessionId, 1);
    await seedRecommendation(db, otherSession, 9);

    const latest = await db
      .prepare(
        "SELECT round_number, ai_response FROM recommendations WHERE session_id = ? ORDER BY round_number DESC LIMIT 1"
      )
      .bind(sessionId)
      .first<{ round_number: number }>();
    expect(latest?.round_number).toBe(3);
  });

  it("still counts only this month's matches", async () => {
    const db = createFakeD1(schemaWithIndexes());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRecommendation(db, sessionId, 1, { createdAt: "2020-01-15T00:00:00.000Z" });
    await seedRecommendation(db, sessionId, 2, { createdAt: new Date().toISOString() });

    expect((await getMatchRoundContext(db, sessionId)).matchesThisMonth).toBe(1);
  });
});

/** Writes a round whose ai_response column is exactly the given text (valid JSON or not). */
function seedRawRound(db: D1Database, sessionId: string, round: number, aiResponse: string) {
  return db
    .prepare(
      `INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids, removed_tmdb_ids,
         steering_feedback, model, prompt_version, candidate_snapshot, created_at)
       VALUES (?, ?, ?, ?, '[]', '[]', '', 'm', 'p', '[]', ?)`
    )
    .bind(crypto.randomUUID(), sessionId, round, aiResponse, new Date().toISOString())
    .run();
}

function roundWithRecommendations(tmdbIds: number[]): string {
  return JSON.stringify({
    tasteMap: { members: [], overlap: { summary: "", sharedVibes: [], tensionPoints: [] } },
    recommendations: tmdbIds.map((id) => ({ tmdbId: id, matchScore: 90, explanation: "e" })),
    conversational: "c",
  });
}

describe("recommended id provenance", () => {
  it("unions the tmdb ids recommended across every prior round of the session", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);
    const otherSession = await newSession(db);

    await seedRawRound(db, sessionId, 1, roundWithRecommendations([1, 2]));
    await seedRawRound(db, sessionId, 2, roundWithRecommendations([2, 3]));
    await seedRawRound(db, otherSession, 1, roundWithRecommendations([99]));

    const ids = (await getMatchRoundContext(db, sessionId)).recommendedTmdbIds;

    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("returns an empty set for a session with no rounds", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    expect((await getMatchRoundContext(db, sessionId)).recommendedTmdbIds).toEqual(new Set());
  });

  it("skips a corrupt ai_response row and still returns the other rounds' ids", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRawRound(db, sessionId, 1, "not json");
    await seedRawRound(db, sessionId, 2, roundWithRecommendations([7, 8]));

    const ids = (await getMatchRoundContext(db, sessionId)).recommendedTmdbIds;

    expect([...ids].sort((a, b) => a - b)).toEqual([7, 8]);
  });

  it("ignores non-integer tmdb ids inside a stored round", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRawRound(
      db,
      sessionId,
      1,
      JSON.stringify({
        recommendations: [{ tmdbId: "12" }, { tmdbId: 1.5 }, { tmdbId: 42 }, null],
      })
    );

    expect((await getMatchRoundContext(db, sessionId)).recommendedTmdbIds).toEqual(new Set([42]));
  });

  it("skips a round whose recommendations field is not an array", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);
    const sessionId = await newSession(db);

    await seedRawRound(db, sessionId, 1, JSON.stringify({ recommendations: 5 }));
    await seedRawRound(db, sessionId, 2, roundWithRecommendations([7, 8]));

    const ids = (await getMatchRoundContext(db, sessionId)).recommendedTmdbIds;

    expect([...ids].sort((a, b) => a - b)).toEqual([7, 8]);
  });
});
