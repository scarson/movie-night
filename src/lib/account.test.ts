// ABOUTME: Tests for deleteAccount — deletes the user row while anonymizing shared
// ABOUTME: session_members/movie_sessions records instead of cascading their deletion.

import { describe, it, expect } from "vitest";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import type { MatchingResponse } from "@/types/matching";
import { deleteAccount, DELETED_USER_LABEL } from "./account";

const NOW = "2026-01-01T00:00:00.000Z";

function seedUser(db: D1Database, id: string, email: string, name: string = id) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, email, name, NOW)
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

function seedRecommendation(
  db: D1Database,
  id: string,
  sessionId: string,
  aiResponse: string
) {
  return db
    .prepare(
      `INSERT INTO recommendations (id, session_id, round_number, ai_response, kept_tmdb_ids, removed_tmdb_ids,
         steering_feedback, model, prompt_version, candidate_snapshot, created_at)
       VALUES (?, ?, 1, ?, '[]', '[]', '', 'm', 'p', '[]', ?)`
    )
    .bind(id, sessionId, aiResponse, NOW)
    .run();
}

interface RoundOverrides {
  memberNames?: [string, string];
  memberSummaries?: [string, string];
  overlapSummary?: string;
  explanation?: string;
  conversational?: string;
}

/** A two-member round: u1 and u2, each named in the structured map and in prose. */
function round(overrides: RoundOverrides = {}): MatchingResponse {
  const [nameA, nameB] = overrides.memberNames ?? ["Alice", "Bob"];
  const [summaryA, summaryB] = overrides.memberSummaries ?? [
    `${nameA} reaches for precise films.`,
    `${nameB} wants warmth.`,
  ];
  return {
    tasteMap: {
      members: [
        { userId: "u1", name: nameA, summary: summaryA, primaryVibes: ["Cerebral"], genreAffinities: ["Sci-Fi"] },
        { userId: "u2", name: nameB, summary: summaryB, primaryVibes: ["Cozy"], genreAffinities: ["Comedy"] },
      ],
      overlap: {
        summary: overrides.overlapSummary ?? `${nameA} and ${nameB} both like a heist.`,
        sharedVibes: ["Witty"],
        tensionPoints: ["One sits with ambiguity longer."],
      },
    },
    recommendations: [
      { tmdbId: 27205, matchScore: 92, explanation: overrides.explanation ?? `A grief-shaped hole for ${nameA}.` },
    ],
    conversational: overrides.conversational ?? `Tonight leans toward ${nameA} and ${nameB}.`,
  };
}

/** Seeds a two-member session (u1, u2) carrying one persisted round. */
async function seedTwoMemberRound(
  db: D1Database,
  nameA: string,
  response: MatchingResponse,
  nameB = "Bob"
) {
  await seedUser(db, "u1", "u1@example.com", nameA);
  await seedUser(db, "u2", "u2@example.com", nameB);
  await seedGroup(db, "grp1", "CODE0001");
  await seedGroupMember(db, "gm1", "grp1", "u1");
  await seedGroupMember(db, "gm2", "grp1", "u2");
  await seedMovieSession(db, "sess1", "grp1", "u1");
  await seedSessionMember(db, "sm1", "sess1", "u1");
  await seedSessionMember(db, "sm2", "sess1", "u2");
  await seedRecommendation(db, "rec1", "sess1", JSON.stringify(response));
}

async function storedRound(db: D1Database, id = "rec1"): Promise<MatchingResponse> {
  const row = await db
    .prepare("SELECT ai_response FROM recommendations WHERE id = ?")
    .bind(id)
    .first<{ ai_response: string }>();
  return JSON.parse(row!.ai_response) as MatchingResponse;
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

describe("deleteAccount — groups the user leaves behind", () => {
  it("leaves a group intact when its last member deletes their account", async () => {
    // Deliberately NOT cascaded. "Empty" is defined by group_members, but a
    // member who left via leaveGroup keeps their session_members rows and a
    // legitimate read of that history — so "A leaves, B deletes" would destroy
    // every session A can still read. groups -> movie_sessions ->
    // recommendations all CASCADE, and none of it is recoverable.
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1", "u1@example.com");
    await seedGroup(db, "grp1", "CODE0001");
    await seedGroupMember(db, "gm1", "grp1", "u1");
    await seedMovieSession(db, "sess1", "grp1", "u1");
    await seedSessionMember(db, "sm1", "sess1", "u1");
    await seedRecommendation(db, "rec1", "sess1", JSON.stringify(round()));

    await deleteAccount(db, "u1", () => {});

    expect(await db.prepare("SELECT id FROM groups WHERE id = ?").bind("grp1").first()).not.toBeNull();
    expect(
      await db.prepare("SELECT id FROM movie_sessions WHERE id = ?").bind("sess1").first()
    ).not.toBeNull();
    expect(
      await db.prepare("SELECT id FROM recommendations WHERE id = ?").bind("rec1").first()
    ).not.toBeNull();
    // The membership itself is gone — that is what the copy now promises.
    const { results: memberships } = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ?")
      .bind("grp1")
      .all();
    expect(memberships).toHaveLength(0);
  });
});

describe("deleteAccount — scrubbing the deleted name from persisted rounds", () => {
  it("replaces the deleted member's name in tasteMap.members and leaves the survivor's alone", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "Alice", round());

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(doc.tasteMap.members[1].name).toBe("Bob");
  });

  it("replaces the deleted member's name in the conversational prose, including a possessive", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(
      db,
      "Alice",
      round({ conversational: "Tonight leans warm for Alice. Alice's pick is the heist." })
    );

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.conversational).toBe(
      `Tonight leans warm for ${DELETED_USER_LABEL}. ${DELETED_USER_LABEL}'s pick is the heist.`
    );
  });

  it("scrubs the overlap summary, member summaries, and recommendation explanations", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(
      db,
      "Alice",
      round({
        memberSummaries: ["Alice reaches for precise films.", "Bob wants warmth, unlike Alice."],
        overlapSummary: "Alice and Bob both like a heist.",
        explanation: "A grief-shaped hole, aimed at Alice.",
      })
    );

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].summary).toBe(`${DELETED_USER_LABEL} reaches for precise films.`);
    expect(doc.tasteMap.members[1].summary).toBe(`Bob wants warmth, unlike ${DELETED_USER_LABEL}.`);
    expect(doc.tasteMap.overlap.summary).toBe(`${DELETED_USER_LABEL} and Bob both like a heist.`);
    expect(doc.recommendations[0].explanation).toBe(`A grief-shaped hole, aimed at ${DELETED_USER_LABEL}.`);
  });

  it("does not replace a name that appears as a substring of another word", async () => {
    // "Al" is exactly at the two-character boundary, so it IS scrubbed where it
    // stands alone — but "Alfredo" must survive intact.
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(
      db,
      "Al",
      round({ conversational: "Al picked Big Night. Alfredo is the point of that film." })
    );

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.conversational).toBe(
      `${DELETED_USER_LABEL} picked Big Night. Alfredo is the point of that film.`
    );
  });

  it("skips the free-text replacement for a one-character name but still scrubs the structured field", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "A", round({ conversational: "A wants a comedy. A lot of them." }));

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(doc.conversational).toBe("A wants a comedy. A lot of them.");
  });

  it("does not rewrite JSON keys when the name collides with one", async () => {
    // The scrub operates on the parsed object, so a user called "name" cannot
    // rewrite the document's keys and break deserialization.
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "name", round({ conversational: "name and Bob agreed." }));

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0]).toHaveProperty("name");
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(doc.tasteMap.members[0]).toHaveProperty("summary");
    expect(doc.recommendations[0]).toHaveProperty("explanation");
    expect(doc.conversational).toBe(`${DELETED_USER_LABEL} and Bob agreed.`);
  });

  it("leaves a same-named surviving member alone, scrubbing only the structured field", async () => {
    const db = createFakeD1(loadMigration());
    const lines: string[] = [];
    await seedTwoMemberRound(
      db,
      "Sam",
      round({
        memberNames: ["Sam", "sam"],
        conversational: "Sam and sam are the same word tonight.",
      }),
      "sam"
    );

    await deleteAccount(db, "u1", (line) => lines.push(line));

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    // A literal replacement here would scrub the SURVIVOR out of their own record.
    expect(doc.tasteMap.members[1].name).toBe("sam");
    expect(doc.conversational).toBe("Sam and sam are the same word tonight.");
    expect(lines.map((line) => JSON.parse(line))).toContainEqual({
      event: "scrub_name_shared_with_member",
      recommendationId: "rec1",
    });
  });

  it("also replaces a film title that happens to match the name — the accepted collateral", async () => {
    // A literal replacement cannot tell the member "Carrie" from the film
    // "Carrie". This test exists to make that visible rather than surprising.
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(
      db,
      "Carrie",
      round({
        explanation: "Carrie is the obvious pick for a prom-night horror.",
        conversational: "Carrie asked for something with teeth.",
      })
    );

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.conversational).toBe(`${DELETED_USER_LABEL} asked for something with teeth.`);
    expect(doc.recommendations[0].explanation).toBe(
      `${DELETED_USER_LABEL} is the obvious pick for a prom-night horror.`
    );
  });

  it("handles a hyphenated name without throwing", async () => {
    // Escaping "-" for the RegExp is a SyntaxError under the "u" flag, which
    // would turn deleteAccount into a 500 for this user.
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(
      db,
      "Anne-Marie",
      round({ conversational: "Anne-Marie wanted something quiet." })
    );

    await expect(deleteAccount(db, "u1")).resolves.toBeUndefined();

    const doc = await storedRound(db);
    expect(doc.conversational).toBe(`${DELETED_USER_LABEL} wanted something quiet.`);
  });

  it("scrubs before the batch anonymizes the join key it needs", async () => {
    // The scrub finds rows via session_members.user_id and reads the name from
    // the users row — the batch destroys both. Running it after would silently
    // scrub nothing.
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "Alice", round());

    await deleteAccount(db, "u1");

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(doc.conversational).not.toContain("Alice");

    // The batch still ran: the join key is gone and the user row with it.
    const member = await db
      .prepare("SELECT user_id FROM session_members WHERE id = ?")
      .bind("sm1")
      .first<{ user_id: string }>();
    expect(member!.user_id).toMatch(/^deleted-[0-9a-f]{8}$/);
    expect(await db.prepare("SELECT id FROM users WHERE id = ?").bind("u1").first()).toBeNull();
  });

  it("tolerates an unparseable ai_response row, scrubbing the rest and completing", async () => {
    const db = createFakeD1(loadMigration());
    const lines: string[] = [];
    await seedTwoMemberRound(db, "Alice", round());
    await seedRecommendation(db, "rec-corrupt", "sess1", "{not json");

    await expect(deleteAccount(db, "u1", (line) => lines.push(line))).resolves.toBeUndefined();

    const doc = await storedRound(db);
    expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
    expect(lines.map((line) => JSON.parse(line))).toContainEqual({
      event: "scrub_unparseable_round",
      recommendationId: "rec-corrupt",
    });
    const corrupt = await db
      .prepare("SELECT ai_response FROM recommendations WHERE id = ?")
      .bind("rec-corrupt")
      .first<{ ai_response: string }>();
    expect(corrupt!.ai_response).toBe("{not json");
  });

  it("scrubs every round of every session the deleted user belonged to", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "Alice", round());
    await seedRecommendation(db, "rec2", "sess1", JSON.stringify(round()));

    await deleteAccount(db, "u1");

    for (const id of ["rec1", "rec2"]) {
      const doc = await storedRound(db, id);
      expect(doc.tasteMap.members[0].name).toBe(DELETED_USER_LABEL);
      expect(doc.conversational).not.toContain("Alice");
    }
  });

  it("leaves rounds from sessions the deleted user was never a member of untouched", async () => {
    const db = createFakeD1(loadMigration());
    await seedTwoMemberRound(db, "Alice", round());
    await seedMovieSession(db, "sess2", "grp1", "u2");
    await seedSessionMember(db, "sm3", "sess2", "u2");
    await seedRecommendation(db, "rec-other", "sess2", JSON.stringify(round()));

    await deleteAccount(db, "u1");

    const doc = await storedRound(db, "rec-other");
    expect(doc.tasteMap.members[0].name).toBe("Alice");
    expect(doc.conversational).toContain("Alice");
  });
});
