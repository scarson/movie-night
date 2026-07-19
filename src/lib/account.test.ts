// ABOUTME: Tests for deleteAccount — deletes the user row while anonymizing shared
// ABOUTME: session_members/movie_sessions records instead of cascading their deletion.

import { describe, it, expect } from "vitest";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { deleteAccount } from "./account";

const NOW = "2026-01-01T00:00:00.000Z";

function seedUser(db: D1Database, id: string, email: string) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, email, id, NOW)
    .run();
}

function seedGroup(db: D1Database, id: string, inviteCode: string) {
  return db
    .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `Group ${id}`, inviteCode, NOW)
    .run();
}

function seedGroupMember(db: D1Database, id: string, groupId: string, userId: string) {
  return db
    .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
    .bind(id, groupId, userId, NOW)
    .run();
}

function seedProfile(db: D1Database, userId: string) {
  return db
    .prepare("INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)")
    .bind(userId, NOW)
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

describe("deleteAccount", () => {
  it("deletes the users row, cascading sessions/profile/group_members", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedProfile(db, "u1");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroup(db, "grp2", "CODE0002");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroupMember(db, "gm2", "grp2", "u1");

    await deleteAccount(db, "u1");

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind("u1").first();
    expect(user).toBeNull();

    const profile = await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind("u1").first();
    expect(profile).toBeNull();

    const { results: memberships } = await db
      .prepare("SELECT * FROM group_members WHERE user_id = ?")
      .bind("u1")
      .all();
    expect(memberships).toHaveLength(0);
  });

  it("anonymizes session_members with a per-row random sentinel instead of deleting the row", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");

    await deleteAccount(db, "u1");

    const member = await db
      .prepare("SELECT * FROM session_members WHERE id = ?")
      .bind("sm1")
      .first<{ user_id: string }>();
    expect(member).not.toBeNull();
    expect(member!.user_id).toMatch(/^deleted-[0-9a-f]{8}$/);
    expect(member!.user_id).not.toBe("u1");
  });

  it("sets movie_sessions.initiated_by_user_id to the fixed 'deleted' sentinel", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");

    await deleteAccount(db, "u1");

    const session = await db
      .prepare("SELECT initiated_by_user_id FROM movie_sessions WHERE id = ?")
      .bind("sess1")
      .first<{ initiated_by_user_id: string }>();
    expect(session!.initiated_by_user_id).toBe("deleted");
  });

  it("leaves other members' session_members and group_members rows untouched", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedUser(db, "u2", "u2@example.com");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroupMember(db, "gm2", "grp1", "u2");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");
    await seedSessionMember(db, "sm2", "sess1", "u2");

    await deleteAccount(db, "u1");

    const u2Membership = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind("grp1", "u2")
      .first();
    expect(u2Membership).not.toBeNull();

    const u2SessionMember = await db
      .prepare("SELECT user_id FROM session_members WHERE id = ?")
      .bind("sm2")
      .first<{ user_id: string }>();
    expect(u2SessionMember!.user_id).toBe("u2");

    const u2User = await db.prepare("SELECT * FROM users WHERE id = ?").bind("u2").first();
    expect(u2User).not.toBeNull();
  });

  it("handles two members of the same session both deleting their accounts without a UNIQUE constraint violation", async () => {
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedUser(db, "u2", "u2@example.com");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedGroupMember(db, "gm2", "grp1", "u2");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");
    await seedSessionMember(db, "sm2", "sess1", "u2");

    await deleteAccount(db, "u1");
    // A fixed 'deleted' sentinel would collide here on UNIQUE(session_id, user_id)
    // once a second member of the same session deletes their account — this must
    // not throw.
    await expect(deleteAccount(db, "u2")).resolves.toBeUndefined();

    const { results: members } = await db
      .prepare("SELECT user_id FROM session_members WHERE session_id = ? ORDER BY id")
      .bind("sess1")
      .all<{ user_id: string }>();
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m.user_id).toMatch(/^deleted-[0-9a-f]{8}$/);
    }
    // Distinct sentinels — the whole point of the per-row random suffix.
    expect(members[0].user_id).not.toBe(members[1].user_id);

    const users = await db.prepare("SELECT id FROM users").all();
    expect(users.results).toHaveLength(0);
  });
});
