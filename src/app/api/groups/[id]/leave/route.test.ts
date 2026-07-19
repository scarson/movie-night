// ABOUTME: Tests for POST /api/groups/[id]/leave — removes the caller's membership only,
// ABOUTME: idempotently, without disturbing other members or session history.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { createGroup, joinGroup } from "@/lib/groups";

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

async function authedRequest(url: string, userId: string): Promise<NextRequest> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  return new NextRequest(url, { method: "POST", headers: { cookie: `mn-session=${jwt}` } });
}

describe("POST /api/groups/[id]/leave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const group = await createGroup(db, "u1", "Movie Nighters");

    const { POST } = await import("./route");
    const response = await POST(new NextRequest(`https://example.com/api/groups/${group.id}/leave`, { method: "POST" }), {
      params: Promise.resolve({ id: group.id }),
    });

    expect(response.status).toBe(401);
  });

  it("removes the caller's membership, leaving other members intact", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    const group = await createGroup(db, "u1", "Movie Nighters");
    await joinGroup(db, "u2", group.inviteCode);

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest(`https://example.com/api/groups/${group.id}/leave`, "u1"),
      { params: Promise.resolve({ id: group.id }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const membership = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(group.id, "u1")
      .first();
    expect(membership).toBeNull();

    const otherMembership = await db
      .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(group.id, "u2")
      .first();
    expect(otherMembership).not.toBeNull();
  });

  it("is idempotent — returns 200 even when the caller is not a member", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const group = await createGroup(db, "u1", "Movie Nighters");
    await seedUser(db, "u2", "Alex");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest(`https://example.com/api/groups/${group.id}/leave`, "u2"),
      { params: Promise.resolve({ id: group.id }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
