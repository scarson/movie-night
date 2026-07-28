// ABOUTME: Tests for group lifecycle (create/join/leave), invite-code generation,
// ABOUTME: and join-attempt rate limiting — all exercised against the real-SQL fake D1.

import { describe, it, expect } from "vitest";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import {
  createGroup,
  joinGroup,
  getGroupsForUser,
  leaveGroup,
  checkJoinRateLimit,
  logJoinAttempt,
  ReservedGroupNameError,
  SOLO_GROUP_NAME,
} from "./groups";

const NOW = "2026-01-01T00:00:00.000Z";
const INVITE_CODE_RE = /^[2-9A-Za-z]{8}$/;

function seedUser(db: D1Database, id: string, name: string, avatarUrl: string | null = null) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, name, avatarUrl, NOW)
    .run();
}

function seedGroup(db: D1Database, id: string, name: string, inviteCode: string) {
  return db
    .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, inviteCode, NOW)
    .run();
}

function seedGroupMember(db: D1Database, id: string, groupId: string, userId: string) {
  return db
    .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
    .bind(id, groupId, userId, NOW)
    .run();
}

function seedMovieSession(db: D1Database, id: string, groupId: string, initiatedBy: string) {
  return db
    .prepare(
      "INSERT INTO movie_sessions (id, group_id, initiated_by_user_id, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(id, groupId, initiatedBy, NOW)
    .run();
}

function seedSessionMember(db: D1Database, id: string, sessionId: string, userId: string) {
  return db
    .prepare("INSERT INTO session_members (id, session_id, user_id) VALUES (?, ?, ?)")
    .bind(id, sessionId, userId)
    .run();
}

function seedRateLimitAttempt(db: D1Database, scope: string, key: string, at: string) {
  return db
    .prepare("INSERT INTO rate_limit_log (scope, key, at) VALUES (?, ?, ?)")
    .bind(scope, key, at)
    .run();
}

describe("createGroup", () => {
  it("creates a group with an 8-char invite code from the safe alphabet, adds the creator as a member, and returns the group", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam", "https://example.com/sam.png");

    const group = await createGroup(db, "u1", "Movie Nighters");

    expect(group.name).toBe("Movie Nighters");
    expect(group.inviteCode).toMatch(INVITE_CODE_RE);
    expect(group.members).toHaveLength(1);
    expect(group.members[0]).toEqual({
      userId: "u1",
      name: "Sam",
      avatarUrl: "https://example.com/sam.png",
    });

    const { results: memberRows } = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ?")
      .bind(group.id)
      .all();
    expect(memberRows).toHaveLength(1);
  });

  it("rejects the reserved name \"__solo__\"", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    await expect(createGroup(db, "u1", SOLO_GROUP_NAME)).rejects.toThrow(ReservedGroupNameError);

    const { results } = await db.prepare("SELECT * FROM groups").all();
    expect(results).toHaveLength(0);
  });
});

describe("joinGroup", () => {
  it("adds the joining user as a group member", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");
    await seedGroupMember(db, "gm1", "grp1", "u1");

    const group = await joinGroup(db, "u2", "ABCD2345");

    expect(group).not.toBeNull();
    expect(group!.id).toBe("grp1");
    expect(group!.name).toBe("Movie Nighters");

    const member = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind("grp1", "u2")
      .first();
    expect(member).not.toBeNull();
  });

  it("is idempotent — joining twice returns the group without a duplicate row", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");

    await joinGroup(db, "u1", "ABCD2345");
    const second = await joinGroup(db, "u1", "ABCD2345");

    expect(second).not.toBeNull();
    expect(second!.id).toBe("grp1");

    const { results: memberRows } = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind("grp1", "u1")
      .all();
    expect(memberRows).toHaveLength(1);
  });

  it("returns null for an unknown code", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const group = await joinGroup(db, "u1", "ZZZZ9999");

    expect(group).toBeNull();
  });

  it("treats a code belonging to a \"__solo__\" group as unknown", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroup(db, "solo-grp", SOLO_GROUP_NAME, "SOLO2345");
    await seedGroupMember(db, "gm1", "solo-grp", "u1");

    const group = await joinGroup(db, "u2", "SOLO2345");

    expect(group).toBeNull();
  });
});

describe("getGroupsForUser", () => {
  it("returns the user's groups with member arrays (id, name, avatarUrl)", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam", "https://example.com/sam.png");
    await seedUser(db, "u2", "Alex", null);
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroupMember(db, "gm2", "grp1", "u2");

    const groups = await getGroupsForUser(db, "u1");

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("grp1");
    expect(groups[0].name).toBe("Movie Nighters");
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members).toEqual(
      expect.arrayContaining([
        { userId: "u1", name: "Sam", avatarUrl: "https://example.com/sam.png" },
        { userId: "u2", name: "Alex", avatarUrl: null },
      ])
    );
  });

  it("excludes groups named \"__solo__\"", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroup(db, "solo-grp", SOLO_GROUP_NAME, "SOLO2345");
    await seedGroupMember(db, "gm2", "solo-grp", "u1");

    const groups = await getGroupsForUser(db, "u1");

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("grp1");
  });

  it("returns an empty array for a user with no groups", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");

    const groups = await getGroupsForUser(db, "u1");

    expect(groups).toEqual([]);
  });
});

describe("leaveGroup", () => {
  it("removes only the group_members row, preserving session history", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroupMember(db, "gm2", "grp1", "u2");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");

    await leaveGroup(db, "u1", "grp1");

    const membership = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind("grp1", "u1")
      .first();
    expect(membership).toBeNull();

    // The other member's membership and the shared session history are untouched.
    const otherMembership = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind("grp1", "u2")
      .first();
    expect(otherMembership).not.toBeNull();

    const session = await db.prepare("SELECT * FROM movie_sessions WHERE id = ?").bind("sess1").first();
    expect(session).not.toBeNull();

    const sessionMember = await db
      .prepare("SELECT * FROM session_members WHERE id = ?")
      .bind("sm1")
      .first();
    expect(sessionMember).not.toBeNull();
  });

  it("does not throw when the user is not a member of the group", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "Sam");
    await seedGroup(db, "grp1", "Movie Nighters", "ABCD2345");

    await expect(leaveGroup(db, "u1", "grp1")).resolves.toBeUndefined();
  });
});

describe("checkJoinRateLimit / logJoinAttempt", () => {
  it("returns true when fewer than 10 attempts are logged in the last 10 minutes", async () => {
    const db = createFakeD1(loadMigration());
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    for (let i = 0; i < 9; i++) {
      await seedRateLimitAttempt(db, "group_join", "u1", recent);
    }

    await expect(checkJoinRateLimit(db, "u1")).resolves.toBe(true);
  });

  it("returns false once 10 or more attempts are logged in the last 10 minutes", async () => {
    const db = createFakeD1(loadMigration());
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      await seedRateLimitAttempt(db, "group_join", "u1", recent);
    }

    await expect(checkJoinRateLimit(db, "u1")).resolves.toBe(false);
  });

  it("ignores attempts older than 10 minutes", async () => {
    const db = createFakeD1(loadMigration());
    const old = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      await seedRateLimitAttempt(db, "group_join", "u1", old);
    }

    await expect(checkJoinRateLimit(db, "u1")).resolves.toBe(true);
  });

  it("scopes the count to 'group_join' and to the given key", async () => {
    const db = createFakeD1(loadMigration());
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      await seedRateLimitAttempt(db, "match", "u1", recent); // different scope
      await seedRateLimitAttempt(db, "group_join", "u2", recent); // different key
    }

    await expect(checkJoinRateLimit(db, "u1")).resolves.toBe(true);
  });

  it("logJoinAttempt inserts a row that checkJoinRateLimit later counts", async () => {
    const db = createFakeD1(loadMigration());

    for (let i = 0; i < 10; i++) {
      await logJoinAttempt(db, "u1");
    }

    const { results } = await db
      .prepare("SELECT * FROM rate_limit_log WHERE scope = 'group_join' AND key = ?")
      .bind("u1")
      .all();
    expect(results).toHaveLength(10);
    await expect(checkJoinRateLimit(db, "u1")).resolves.toBe(false);
  });
});
