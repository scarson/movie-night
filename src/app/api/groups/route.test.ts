// ABOUTME: Tests for GET/POST /api/groups (list the caller's groups; create a group).
// ABOUTME: Real fake D1 + real authenticateRequest via a signed JWT cookie; only the
// ABOUTME: Cloudflare context accessor is mocked (external platform boundary).

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

async function authedRequest(
  url: string,
  userId: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<NextRequest> {
  const jwt = await createJWT({ userId, email: `${userId}@example.com` }, JWT_SECRET);
  const headers: Record<string, string> = { cookie: `mn-session=${jwt}` };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("GET /api/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://example.com/api/groups"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the caller's groups", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");
    await createGroup(db, "u1", "Movie Nighters");

    const { GET } = await import("./route");
    const response = await GET(await authedRequest("https://example.com/api/groups", "u1"));

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].name).toBe("Movie Nighters");
    expect(body.groups[0].members).toEqual([{ userId: "u1", name: "Sam", avatarUrl: null }]);
  });
});

describe("POST /api/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Movie Nighters" }),
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const jwt = await createJWT({ userId: "u1", email: "u1@example.com" }, JWT_SECRET);
    const response = await POST(
      new NextRequest("https://example.com/api/groups", {
        method: "POST",
        headers: { cookie: `mn-session=${jwt}`, "content-type": "application/json" },
        body: "not valid json{{{",
      })
    );

    expect(response.status).toBe(400);
  });

  it("creates a group and returns it with the invite code and creator as member", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: { name: "Movie Nighters" },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, any>>();
    expect(body.group.name).toBe("Movie Nighters");
    expect(body.group.inviteCode).toMatch(/^[2-9A-Za-z]{8}$/);
    expect(body.group.members).toEqual([{ userId: "u1", name: "Sam", avatarUrl: null }]);
  });

  it("trims the name and rejects it if empty after trimming", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: { name: "   " },
      })
    );

    expect(response.status).toBe(400);
  });

  it("rejects a name longer than 50 characters", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: { name: "x".repeat(51) },
      })
    );

    expect(response.status).toBe(400);
  });

  it("accepts a name at exactly the 50-character boundary", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: { name: "x".repeat(50) },
      })
    );

    expect(response.status).toBe(200);
  });

  it("rejects the reserved name \"__solo__\" with a 400", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: { name: "__solo__" },
      })
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for a missing name field", async () => {
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    await seedUser(db, "u1", "Sam");

    const { POST } = await import("./route");
    const response = await POST(
      await authedRequest("https://example.com/api/groups", "u1", {
        method: "POST",
        body: {},
      })
    );

    expect(response.status).toBe(400);
  });
});
