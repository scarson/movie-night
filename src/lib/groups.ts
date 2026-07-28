// ABOUTME: Group lifecycle — create/join/leave, invite-code generation, and join-attempt
// ABOUTME: rate limiting. "__solo__" is a reserved name for Task 5.4's per-user personal group.

import { customAlphabet } from "nanoid";
import { sqliteIsoNow } from "@/lib/db";

const generateInviteCode = customAlphabet(
  "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz",
  8
);

export const SOLO_GROUP_NAME = "__solo__";

const JOIN_RATE_LIMIT_SCOPE = "group_join";
const JOIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const JOIN_RATE_LIMIT_WINDOW = "-10 minutes";

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
}

export interface GroupMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface GroupWithMembers extends Group {
  members: GroupMember[];
}

export class ReservedGroupNameError extends Error {
  constructor() {
    super(`"${SOLO_GROUP_NAME}" is a reserved group name`);
    this.name = "ReservedGroupNameError";
  }
}

interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

interface MemberRow {
  user_id: string;
  name: string;
  avatar_url: string | null;
}

function rowToGroup(row: GroupRow): Group {
  return { id: row.id, name: row.name, inviteCode: row.invite_code, createdAt: row.created_at };
}

async function fetchMembers(db: D1Database, groupId: string): Promise<GroupMember[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id as user_id, u.name, u.avatar_url
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at ASC`
    )
    .bind(groupId)
    .all<MemberRow>();

  return results.map((row) => ({ userId: row.user_id, name: row.name, avatarUrl: row.avatar_url }));
}

/** Creates a group, adds the creator as its first member, and returns it with the member list. */
export async function createGroup(
  db: D1Database,
  userId: string,
  name: string
): Promise<GroupWithMembers> {
  if (name === SOLO_GROUP_NAME) {
    throw new ReservedGroupNameError();
  }

  const id = crypto.randomUUID();
  const inviteCode = generateInviteCode();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)").bind(
      id,
      name,
      inviteCode,
      now
    ),
    db
      .prepare("INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, userId, now),
  ]);

  return { id, name, inviteCode, createdAt: now, members: await fetchMembers(db, id) };
}

/**
 * Adds userId as a member of the group identified by the invite code. Idempotent —
 * joining a group the user already belongs to succeeds without a duplicate row.
 * Returns null for an unknown code, including a code that belongs to a "__solo__"
 * group (those are personal groups, never joinable via invite code).
 */
export async function joinGroup(db: D1Database, userId: string, code: string): Promise<Group | null> {
  const row = await db
    .prepare("SELECT id, name, invite_code, created_at FROM groups WHERE invite_code = ? AND name != ?")
    .bind(code, SOLO_GROUP_NAME)
    .first<GroupRow>();

  if (!row) return null;

  await db
    .prepare("INSERT OR IGNORE INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), row.id, userId, new Date().toISOString())
    .run();

  return rowToGroup(row);
}

/**
 * Returns the group (with members) for a member-only detail view. Returns null both
 * when the group doesn't exist AND when the requester isn't a member — the two cases
 * are indistinguishable to the caller, so a route built on this can't leak whether a
 * given group id exists (anti-enumeration). Also excludes "__solo__" groups, which
 * are an internal implementation detail never surfaced through this API.
 */
export async function getGroupDetailForMember(
  db: D1Database,
  userId: string,
  groupId: string
): Promise<GroupWithMembers | null> {
  const membership = await db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .first();
  if (!membership) return null;

  const row = await db
    .prepare("SELECT id, name, invite_code, created_at FROM groups WHERE id = ? AND name != ?")
    .bind(groupId, SOLO_GROUP_NAME)
    .first<GroupRow>();
  if (!row) return null;

  return { ...rowToGroup(row), members: await fetchMembers(db, row.id) };
}

/** Returns every group userId belongs to, with member lists, excluding "__solo__" groups. */
export async function getGroupsForUser(db: D1Database, userId: string): Promise<GroupWithMembers[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.invite_code, g.created_at
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ? AND g.name != ?
       ORDER BY g.created_at ASC`
    )
    .bind(userId, SOLO_GROUP_NAME)
    .all<GroupRow>();

  const groups: GroupWithMembers[] = [];
  for (const row of results) {
    groups.push({ ...rowToGroup(row), members: await fetchMembers(db, row.id) });
  }
  return groups;
}

/** Removes the user's membership only. Session history (session_members, movie_sessions) is preserved. */
export async function leaveGroup(db: D1Database, userId: string, groupId: string): Promise<void> {
  await db
    .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .run();
}

/** Returns true when fewer than 10 join attempts have been logged for `key` in the last 10 minutes. */
export async function checkJoinRateLimit(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM rate_limit_log
       WHERE scope = ? AND key = ? AND at >= ${sqliteIsoNow(JOIN_RATE_LIMIT_WINDOW)}`
    )
    .bind(JOIN_RATE_LIMIT_SCOPE, key)
    .first<{ count: number }>();

  return (row?.count ?? 0) < JOIN_RATE_LIMIT_MAX_ATTEMPTS;
}

/** Logs a join attempt for `key`, counted by checkJoinRateLimit. */
export async function logJoinAttempt(db: D1Database, key: string): Promise<void> {
  await db
    .prepare("INSERT INTO rate_limit_log (scope, key, at) VALUES (?, ?, ?)")
    .bind(JOIN_RATE_LIMIT_SCOPE, key, new Date().toISOString())
    .run();
}
