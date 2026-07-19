// ABOUTME: Tests for POST /api/movie-sessions — validation limits, unconditional group
// ABOUTME: membership check (403), memberFlags authorization, and solo-group-on-demand.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { SOLO_GROUP_NAME } from "@/lib/groups";

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

async function post(userId: string, body: unknown): Promise<Response> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const { POST } = await import("./route");
  return POST(
    new NextRequest("https://example.com/api/movie-sessions", {
      method: "POST",
      headers: { cookie: `mn-session=${jwt}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    groupId: "grp1",
    moodVibes: ["Cozy"],
    moodText: "",
    discoverNew: false,
    isQuickMatch: false,
    roughDay: false,
    ...overrides,
  };
}

describe("POST /api/movie-sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/movie-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      })
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    expect((await post("u1", "broken{{{")).status).toBe(400);
  });

  it("creates a session and session_members for all group members, returning { sessionId }", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    const response = await post("u1", validBody({ roughDay: true }));

    expect(response.status).toBe(200);
    const body = await response.json<{ sessionId: string }>();
    expect(Object.keys(body)).toEqual(["sessionId"]);

    const { results } = await db
      .prepare("SELECT user_id, rough_day FROM session_members WHERE session_id = ? ORDER BY user_id")
      .bind(body.sessionId)
      .all<{ user_id: string; rough_day: number }>();
    expect(results).toEqual([
      { user_id: "u1", rough_day: 1 },
      { user_id: "u2", rough_day: 0 },
    ]);
  });

  it("creates and reuses the __solo__ personal group when groupId is null", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const first = await post("u1", validBody({ groupId: null, isQuickMatch: true }));
    expect(first.status).toBe(200);
    const second = await post("u1", validBody({ groupId: null }));
    expect(second.status).toBe(200);

    const { results } = await db
      .prepare("SELECT id FROM groups WHERE name = ?")
      .bind(SOLO_GROUP_NAME)
      .all();
    expect(results).toHaveLength(1);
  });

  it("returns 403 for a non-member caller even without memberFlags (unconditional check)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "outsider", "Mallory");
    await seedGroupWithMembers(db, "grp1", ["u1"]);

    const response = await post("outsider", validBody());
    expect(response.status).toBe(403);

    const { results } = await db.prepare("SELECT * FROM movie_sessions").all();
    expect(results).toHaveLength(0);
  });

  it("returns 403 when memberFlags contains a non-member key", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "outsider", "Mallory");
    await seedGroupWithMembers(db, "grp1", ["u1"]);

    const response = await post("u1", validBody({ memberFlags: { outsider: { roughDay: true } } }));
    expect(response.status).toBe(403);
  });

  it("lets memberFlags win over roughDay and set other members' flags", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    await seedGroupWithMembers(db, "grp1", ["u1", "u2"]);

    const response = await post(
      "u1",
      validBody({ roughDay: true, memberFlags: { u1: { roughDay: false }, u2: { roughDay: true } } })
    );
    const body = await response.json<{ sessionId: string }>();

    const { results } = await db
      .prepare("SELECT user_id, rough_day FROM session_members WHERE session_id = ? ORDER BY user_id")
      .bind(body.sessionId)
      .all<{ user_id: string; rough_day: number }>();
    expect(results).toEqual([
      { user_id: "u1", rough_day: 0 },
      { user_id: "u2", rough_day: 1 },
    ]);
  });

  it("accepts empty moodVibes (quick-match 'surprise us') and an exactly-200-char moodText", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);

    const response = await post("u1", validBody({ moodVibes: [], moodText: "m".repeat(200) }));
    expect(response.status).toBe(200);
  });

  it("rejects a 10k-char moodText (limit 200) and over-long/over-many mood tags", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedGroupWithMembers(db, "grp1", ["u1"]);

    expect((await post("u1", validBody({ moodText: "m".repeat(10_000) }))).status).toBe(400);
    expect((await post("u1", validBody({ moodVibes: ["v".repeat(10_000)] }))).status).toBe(400);
    expect(
      (await post("u1", validBody({ moodVibes: Array.from({ length: 31 }, (_, i) => `v${i}`) }))).status
    ).toBe(400);
    expect((await post("u1", validBody({ moodVibes: [42] }))).status).toBe(400);

    const { results } = await db.prepare("SELECT * FROM movie_sessions").all();
    expect(results).toHaveLength(0);
  });
});
