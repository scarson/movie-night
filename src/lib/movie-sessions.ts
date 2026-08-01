// ABOUTME: Movie-session lifecycle — solo-group-on-demand, session creation with member-flag
// ABOUTME: authorization, round counting, removed-id accumulation, and member-scoped serialization.

import { SOLO_GROUP_NAME } from "@/lib/groups";
import { parseJsonColumn, chunk, D1_IN_CHUNK_SIZE } from "@/lib/db";
import { MATCHING_MODEL, PROMPT_VERSION } from "@/lib/matching";
import type { StreamingInfo } from "@/lib/tmdb";
import type { MatchingResponse } from "@/types/matching";

/** Thrown when the caller (or a memberFlags key) isn't a member of the target group. Routes map it to 403. */
export class NotGroupMemberError extends Error {
  constructor() {
    super("Not a member of this group");
    this.name = "NotGroupMemberError";
  }
}

/**
 * Returns the user's personal "__solo__" group id, creating it on first use.
 * Inserts directly (createGroup rejects the reserved name by design). The
 * identity is derived from the user, so two callers that both get past the
 * fast-path SELECT claim the same row rather than each creating one. The
 * invite code can never match the 8-char join format, so a solo group is
 * unjoinable at the format check already — and joinGroup excludes the reserved
 * name regardless of code.
 */
export async function createSoloGroup(db: D1Database, userId: string): Promise<string> {
  // Fast path: an existing solo group — including one created while ids were
  // still random — wins outright, and keeps the steady state at one query.
  const existing = await db
    .prepare(
      `SELECT g.id FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ? AND g.name = ?`
    )
    .bind(userId, SOLO_GROUP_NAME)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const groupId = `solo-${userId}`;
  const inviteCode = `solo-${userId}`;
  const now = new Date().toISOString();

  // Three separate statements, deliberately not a batch. D1 enforces foreign
  // keys and group_members.group_id references groups(id), so batching would
  // put the second caller inside a transaction that rolls back on the exact
  // double-tap this exists to absorb. Sequenced, the group row is guaranteed
  // present before the membership insert.

  // Idempotent on the groups PK and on UNIQUE(invite_code).
  await db
    .prepare("INSERT OR IGNORE INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(groupId, SOLO_GROUP_NAME, inviteCode, now)
    .run();

  // The authoritative id, whether this call inserted it or another did. A null
  // here must be loud rather than an FK violation one statement later.
  const row = await db
    .prepare("SELECT id FROM groups WHERE invite_code = ?")
    .bind(inviteCode)
    .first<{ id: string }>();
  if (!row) throw new Error("solo group insert did not land");

  // Idempotent on UNIQUE(group_id, user_id).
  await db
    .prepare("INSERT OR IGNORE INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), row.id, userId, now)
    .run();

  return row.id;
}

export interface CreateMovieSessionArgs {
  userId: string;
  groupId: string | null;
  moodVibes: string[];
  moodText: string;
  discoverNew: boolean;
  isQuickMatch: boolean;
  roughDay: boolean;
  memberFlags?: Record<string, { roughDay: boolean }>;
}

/**
 * Creates a movie session plus a session_members row for every group member.
 * The caller's membership is verified unconditionally; every memberFlags key
 * must also be a member. The caller's rough-day flag comes from memberFlags
 * when present (it wins) or the top-level roughDay otherwise; other members'
 * flags come from memberFlags or default to off.
 */
export async function createMovieSession(
  db: D1Database,
  args: CreateMovieSessionArgs
): Promise<{ sessionId: string }> {
  const groupId = args.groupId ?? (await createSoloGroup(db, args.userId));

  const { results: memberRows } = await db
    .prepare("SELECT user_id FROM group_members WHERE group_id = ?")
    .bind(groupId)
    .all<{ user_id: string }>();
  const memberIds = memberRows.map((row) => row.user_id);

  if (!memberIds.includes(args.userId)) throw new NotGroupMemberError();
  const flags = args.memberFlags ?? {};
  for (const flaggedId of Object.keys(flags)) {
    if (!memberIds.includes(flaggedId)) throw new NotGroupMemberError();
  }

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO movie_sessions (id, group_id, initiated_by_user_id, mood_vibes, mood_text, discover_new, is_quick_match, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        sessionId,
        groupId,
        args.userId,
        JSON.stringify(args.moodVibes),
        args.moodText,
        args.discoverNew ? 1 : 0,
        args.isQuickMatch ? 1 : 0,
        now
      ),
    ...memberIds.map((memberId) => {
      const roughDay =
        flags[memberId]?.roughDay ?? (memberId === args.userId ? args.roughDay : false);
      return db
        .prepare("INSERT INTO session_members (id, session_id, user_id, rough_day) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), sessionId, memberId, roughDay ? 1 : 0);
    }),
  ];
  await db.batch(statements);

  return { sessionId };
}

/** Next round number for the session: prior recommendation count + 1. */
export async function getRoundNumber(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM recommendations WHERE session_id = ?")
    .bind(sessionId)
    .first<{ count: number }>();
  return (row?.count ?? 0) + 1;
}

/** Union of removed tmdb ids across every prior round of the session, deduped. */
export async function getAccumulatedRemovedIds(db: D1Database, sessionId: string): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT removed_tmdb_ids FROM recommendations WHERE session_id = ?")
    .bind(sessionId)
    .all<{ removed_tmdb_ids: string }>();
  const ids = new Set<number>();
  for (const row of results) {
    for (const id of parseJsonColumn<number[]>(row.removed_tmdb_ids, [])) ids.add(id);
  }
  return [...ids];
}

/**
 * Every tmdb id this session has actually recommended, across all prior rounds.
 * A client may only keep or reject a film the session showed it, so this is the
 * provenance set the match route intersects its kept/removed lists against.
 */
export async function getRecommendedTmdbIds(db: D1Database, sessionId: string): Promise<Set<number>> {
  const { results } = await db
    .prepare("SELECT ai_response FROM recommendations WHERE session_id = ?")
    .bind(sessionId)
    .all<{ ai_response: string }>();
  const ids = new Set<number>();
  for (const row of results) {
    const parsed = parseJsonColumn<MatchingResponse | null>(row.ai_response, null);
    for (const rec of parsed?.recommendations ?? []) {
      if (Number.isInteger(rec?.tmdbId)) ids.add(rec.tmdbId);
    }
  }
  return ids;
}

/** Count of matching calls made this calendar month (UTC), across all sessions. */
export async function countMatchesThisMonth(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as count FROM recommendations WHERE created_at >= strftime('%Y-%m-01T00:00:00Z', 'now')"
    )
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export interface SessionView {
  id: string;
  groupId: string;
  moodVibes: string[];
  moodText: string;
  discoverNew: boolean;
  isQuickMatch: boolean;
  solo: boolean;
  createdAt: string;
  /** The REQUESTING member's own flag only — other members' flags are never serialized. */
  roughDay: boolean;
}

/**
 * Member-scoped session view. Returns null both for unknown sessions and for
 * non-members (indistinguishable, so routes can 404 without leaking existence).
 */
export async function getSessionForMember(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<SessionView | null> {
  const row = await db
    .prepare(
      `SELECT ms.id, ms.group_id, ms.mood_vibes, ms.mood_text, ms.discover_new, ms.is_quick_match,
              ms.created_at, sm.rough_day,
              (SELECT COUNT(*) FROM session_members sm2
               JOIN users u2 ON u2.id = sm2.user_id
               WHERE sm2.session_id = ms.id) as member_count
       FROM movie_sessions ms
       JOIN session_members sm ON sm.session_id = ms.id AND sm.user_id = ?
       WHERE ms.id = ?`
    )
    .bind(userId, sessionId)
    .first<{
      id: string;
      group_id: string;
      mood_vibes: string;
      mood_text: string;
      discover_new: number;
      is_quick_match: number;
      created_at: string;
      rough_day: number;
      member_count: number;
    }>();
  if (!row) return null;

  return {
    id: row.id,
    groupId: row.group_id,
    moodVibes: parseJsonColumn<string[]>(row.mood_vibes, []),
    moodText: row.mood_text,
    discoverNew: row.discover_new === 1,
    isQuickMatch: row.is_quick_match === 1,
    // Solo is a property of the session's membership, not the group's name —
    // matching the client (members.length < 2) and CLAUDE.md. A single-member
    // regular group is solo too, so the prompt never seeks overlap for one.
    // member_count joins users for the same reason getSessionMembersWithProfiles
    // does: a member who deleted their account leaves an anonymized
    // session_members row behind but never reaches the model.
    solo: row.member_count < 2,
    createdAt: row.created_at,
    roughDay: row.rough_day === 1,
  };
}

export interface SessionMemberProfile {
  userId: string;
  name: string;
  roughDay: boolean;
  comfortTitles: number[];
  watchlist: number[];
  vibes: string[];
  dealbreakers: string[];
  streamingServices: string[];
}

/**
 * Session members with their saved profiles, for prompt building only (never
 * serialized to API responses — it carries every member's rough-day flag).
 * Members whose user row is gone (deleted accounts) are skipped: they can no
 * longer contribute preferences.
 */
export async function getSessionMembersWithProfiles(
  db: D1Database,
  sessionId: string
): Promise<SessionMemberProfile[]> {
  const { results } = await db
    .prepare(
      `SELECT sm.user_id, sm.rough_day, u.name,
              p.comfort_titles, p.watchlist, p.vibes, p.dealbreakers, p.streaming_services
       FROM session_members sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN profiles p ON p.user_id = sm.user_id
       WHERE sm.session_id = ?`
    )
    .bind(sessionId)
    .all<{
      user_id: string;
      rough_day: number;
      name: string;
      comfort_titles: string | null;
      watchlist: string | null;
      vibes: string | null;
      dealbreakers: string | null;
      streaming_services: string | null;
    }>();

  return results.map((row) => ({
    userId: row.user_id,
    name: row.name,
    roughDay: row.rough_day === 1,
    comfortTitles: parseJsonColumn<number[]>(row.comfort_titles, []),
    watchlist: parseJsonColumn<number[]>(row.watchlist, []),
    vibes: parseJsonColumn<string[]>(row.vibes, []),
    dealbreakers: parseJsonColumn<string[]>(row.dealbreakers, []),
    streamingServices: parseJsonColumn<string[]>(row.streaming_services, []),
  }));
}

export interface TitleSummary {
  title: string;
  year: number | null;
  posterPath: string | null;
  genres: string[];
  streaming: StreamingInfo;
  lastRefreshedAt: string | null;
}

/** Hydrates a tmdbId → title-summary map from D1 so the UI never fuzzy-matches. */
export async function getTitlesMap(
  db: D1Database,
  tmdbIds: number[]
): Promise<Record<number, TitleSummary>> {
  if (tmdbIds.length === 0) return {};
  const map: Record<number, TitleSummary> = {};
  for (const ids of chunk(tmdbIds, D1_IN_CHUNK_SIZE)) {
    const placeholders = ids.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT tmdb_id, title, year, poster_path, genres, streaming, last_refreshed_at
         FROM titles WHERE content_type = 'movie' AND tmdb_id IN (${placeholders})`
      )
      .bind(...ids)
      .all<{
        tmdb_id: number;
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string;
        streaming: string;
        last_refreshed_at: string | null;
      }>();

    for (const row of results) {
      map[row.tmdb_id] = {
        title: row.title,
        year: row.year,
        posterPath: row.poster_path,
        genres: parseJsonColumn<string[]>(row.genres, []),
        streaming: parseJsonColumn<StreamingInfo>(row.streaming, {}),
        lastRefreshedAt: row.last_refreshed_at,
      };
    }
  }
  return map;
}

/** Formats title references for the prompt's keep/exclude lists: "Title (tmdbId N)". Unknown ids are skipped. */
export async function formatTitleRefs(db: D1Database, tmdbIds: number[]): Promise<string[]> {
  const map = await getTitlesMap(db, tmdbIds);
  return tmdbIds
    .filter((id) => map[id] !== undefined)
    .map((id) => `${map[id].title} (tmdbId ${id})`);
}

export interface InsertRecommendationArgs {
  sessionId: string;
  roundNumber: number;
  aiResponse: MatchingResponse;
  keptTmdbIds: number[];
  removedTmdbIds: number[];
  steeringFeedback: string;
  candidateSnapshot: number[];
}

/** Persists one matching round's full record for history and the Sonnet/Opus A/B. */
export async function insertRecommendation(db: D1Database, args: InsertRecommendationArgs): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids, removed_tmdb_ids,
         steering_feedback, model, prompt_version, candidate_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      args.sessionId,
      args.roundNumber,
      JSON.stringify(args.aiResponse),
      JSON.stringify(args.keptTmdbIds),
      JSON.stringify(args.removedTmdbIds),
      args.steeringFeedback,
      MATCHING_MODEL,
      PROMPT_VERSION,
      JSON.stringify(args.candidateSnapshot),
      new Date().toISOString()
    )
    .run();
}
