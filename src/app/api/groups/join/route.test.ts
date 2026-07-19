// ABOUTME: Tests for POST /api/groups/join — code-format validation, rate limiting,
// ABOUTME: unknown-code 404, and the PII-minimal success response (id + name only).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { createGroup, SOLO_GROUP_NAME } from "@/lib/groups";

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

function seedGroup(db: D1Database, id: string, name: string, inviteCode: string) {
  return db
    .prepare("INSERT INTO groups (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, inviteCode, "2026-01-01T00:00:00.000Z")
    .run();
}

function seedRateLimitAttempts(db: D1Database, key: string, count: number) {
  const at = new Date().toISOString();
  const inserts = [];
  for (let i = 0; i < count; i++) {
    inserts.push(
      db.prepare("INSERT INTO rate_limit_log (scope, key, at) VALUES ('group_join', ?, ?)").bind(key, at).run()
    );
  }
  return Promise.all(inserts);
}

async function authedRequest(url: string, userId: string, body: unknown): Promise<NextRequest> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  return new NextRequest(url, {
    method: "POST",
    headers: { cookie: `mn-session=${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/groups/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/groups/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "ABCD2345" }),
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed code, without touching the DB", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const prepareSpy = vi.spyOn(db, "prepare");

    const { POST } = await import("./route");
    const response = await POST(await authedRequest("https://example.com/api/groups/join", "u1", { code: "short" }));

    expect(response.status).toBe(400);
    // authenticateRequest itself queries D1 (JWT is valid here, so it shouldn't even
    // need to), but the join lookup / rate-limit tables must never be touched for a
    // format-invalid code.
    const queriedTables = prepareSpy.mock.calls.map(([sql]) => sql);
    expect(queriedTables.some((sql) => sql.includes("rate_limit_log"))).toBe(false);
    expect(queriedTables.some((sql) => sql.includes("FROM groups"))).toBe(false);
  });

  it("joins a group by valid code and returns only { id, name }", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    const group = await createGroup(db, "u1", "Movie Nighters");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups/join", "u2", { code: group.inviteCode })
    );

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body).toEqual({ id: group.id, name: "Movie Nighters" });
    expect(Object.keys(body).sort()).toEqual(["id", "name"]);

    const member = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(group.id, "u2")
      .first();
    expect(member).not.toBeNull();
  });

  it("returns 404 with the locked error message for an unknown code", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups/join", "u1", { code: "ZZZZ9999" })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That code didn't match a group" });
  });

  it("returns 404 (not the group's real state) for a code belonging to a \"__solo__\" group", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedGroup(db, "solo-grp", SOLO_GROUP_NAME, "SOLO2345");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups/join", "u1", { code: "SOLO2345" })
    );

    expect(response.status).toBe(404);
  });

  it("returns 429 once the caller has hit the join rate limit", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const group = await createGroup(db, "u1", "Movie Nighters");
    await seedRateLimitAttempts(db, "u1", 10);

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups/join", "u1", { code: group.inviteCode })
    );

    expect(response.status).toBe(429);
  });

  it("logs a join attempt on a well-formatted code even when the code is unknown (enumeration counts toward the limit)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    await POST(await authedRequest("https://example.com/api/groups/join", "u1", { code: "ZZZZ9999" }));

    const { results } = await db
      .prepare("SELECT * FROM rate_limit_log WHERE scope = 'group_join' AND key = ?")
      .bind("u1")
      .all();
    expect(results).toHaveLength(1);
  });
});
