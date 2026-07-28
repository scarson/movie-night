// ABOUTME: Tests for GET /api/groups/[id] — member-only group detail. Non-members and
// ABOUTME: nonexistent groups both return 404 (anti-enumeration: existence isn't leaked).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createFakeD1, loadMigration } from "@/test/fake-d1";
import { createJWT } from "@/lib/auth";
import { createGroup } from "@/lib/groups";

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
  return new NextRequest(url, { headers: { cookie: `mn-session=${jwt}` } });
}

describe("GET /api/groups/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const group = await createGroup(db, "u1", "Movie Nighters");

    const { GET } = await import("./route");
    const response = await GET(new NextRequest(`https://example.com/api/groups/${group.id}`), {
      params: Promise.resolve({ id: group.id }),
    });

    expect(response.status).toBe(401);
  });

  it("returns the group with members for a requester who is a member", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    const group = await createGroup(db, "u1", "Movie Nighters");

    const { GET } = await import("./route");
    const response = await GET(await authedRequest(`https://example.com/api/groups/${group.id}`, "u1"), {
      params: Promise.resolve({ id: group.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.group.id).toBe(group.id);
    expect(body.group.name).toBe("Movie Nighters");
    expect(body.group.members).toEqual([{ userId: "u1", name: "Sam", avatarUrl: null }]);
  });

  it("returns 404 for a requester who is not a member (does not leak existence)", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await seedUser(db, "u2", "Alex");
    const group = await createGroup(db, "u1", "Movie Nighters");

    const { GET } = await import("./route");
    const nonMemberResponse = await GET(
      await authedRequest(`https://example.com/api/groups/${group.id}`, "u2"),
      { params: Promise.resolve({ id: group.id }) }
    );
    const nonexistentResponse = await GET(
      await authedRequest("https://example.com/api/groups/does-not-exist", "u2"),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    );

    expect(nonMemberResponse.status).toBe(404);
    expect(nonexistentResponse.status).toBe(404);
    expect(await nonMemberResponse.json()).toEqual(await nonexistentResponse.json());
  });
});
