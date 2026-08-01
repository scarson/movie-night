// ABOUTME: Tests for POST /api/auth/logout — the session rows a logout destroys.
// ABOUTME: Real fake D1 and real rotation via authenticateRequest; only the
// ABOUTME: Cloudflare context accessor is mocked (external platform boundary).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  createFakeD1,
  injectedFailureCount,
  loadMigration,
  withFailingStatement,
} from "@/test/fake-d1";
import { authenticateRequest, sha256 } from "@/lib/auth";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

const JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";

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

function seedUser(db: D1Database, id: string) {
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, `g-${id}`, `${id}@example.com`, id, "2026-01-01T00:00:00.000Z")
    .run();
}

function seedSession(db: D1Database, tokenHash: string, userId: string) {
  return db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, new Date(Date.now() + 86400000).toISOString(), "2026-01-01T00:00:00.000Z")
    .run();
}

function refreshRequest(token: string): NextRequest {
  return new NextRequest("https://example.com/api/auth/logout", {
    method: "POST",
    headers: { cookie: `mn-refresh=${token}` },
  });
}

/** The refresh token a Set-Cookie header just handed the client. */
function refreshTokenFrom(headers: Headers): string {
  const cookie = headers.getSetCookie().find((c) => c.startsWith("mn-refresh="));
  if (!cookie) throw new Error("no mn-refresh cookie was set");
  return cookie.slice("mn-refresh=".length).split(";")[0];
}

/**
 * Signs `userId` in on one device and rotates once, which is the state a client
 * reaches on any request past the 15-minute session-cookie window. Returns the
 * token that rotation spent and the one it issued.
 */
async function rotateOnce(db: D1Database, userId: string, seed: string) {
  const spentToken = `${seed}-refresh-token`;
  const spentHash = await sha256(spentToken);
  await seedSession(db, spentHash, userId);

  const rotated = await authenticateRequest(refreshRequest(spentToken), db, JWT_SECRET);
  return { spentToken, spentHash, liveToken: refreshTokenFrom(rotated.headers) };
}

function sessionRows(db: D1Database) {
  return db
    .prepare("SELECT token_hash, user_id, rotated_at FROM sessions ORDER BY token_hash")
    .all<{ token_hash: string; user_id: string; rotated_at: string | null }>();
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates the predecessor token still inside its rotation grace window", async () => {
    // Rotation keeps a spent token authenticating for 30 seconds so that a
    // client's concurrent requests do not 401 on each other. An explicit logout
    // has to end that too: otherwise the credential the user just revoked keeps
    // working for half a minute after they clicked the button.
    const { POST } = await import("./route");
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1");
    const { spentToken, liveToken } = await rotateOnce(db, "u1", "device-a");

    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    const response = await POST(refreshRequest(liveToken));
    expect(response.status).toBe(200);

    // No timers advanced: this is the middle of the window, not past it.
    const after = await authenticateRequest(refreshRequest(spentToken), db, JWT_SECRET);
    expect(after.user).toBeNull();
    expect(after.headers.has("Set-Cookie")).toBe(false);

    const { results } = await sessionRows(db);
    expect(results).toEqual([]);
  });

  it("leaves another user's spent token authenticating inside its own grace window", async () => {
    // The predicate is scoped to the logging-out user. A logout that reached
    // every spent row would sign out every account mid-rotation.
    const { POST } = await import("./route");
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1");
    await seedUser(db, "u2");
    const mine = await rotateOnce(db, "u1", "mine");
    const theirs = await rotateOnce(db, "u2", "theirs");

    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    expect((await POST(refreshRequest(mine.liveToken))).status).toBe(200);

    const stillGraced = await authenticateRequest(refreshRequest(theirs.spentToken), db, JWT_SECRET);
    expect(stillGraced.user).toEqual({ userId: "u2", email: "u2@example.com" });

    const { results } = await sessionRows(db);
    expect(results.map((row) => row.user_id)).toEqual(["u2", "u2"]);
  });

  it("leaves the same user's other device signed in", async () => {
    // Spent rows are unusable outside their grace window, so scoping the delete
    // to them cannot disturb a session another device is actively holding.
    const { POST } = await import("./route");
    const db = createFakeD1(loadMigration());
    await seedUser(db, "u1");
    const deviceA = await rotateOnce(db, "u1", "device-a");

    const deviceBToken = "device-b-refresh-token";
    const deviceBHash = await sha256(deviceBToken);
    await seedSession(db, deviceBHash, "u1");

    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);
    expect((await POST(refreshRequest(deviceA.liveToken))).status).toBe(200);

    const { results } = await sessionRows(db);
    expect(results.map((row) => row.token_hash)).toEqual([deviceBHash]);
    expect(results[0].rotated_at).toBeNull();

    const deviceB = await authenticateRequest(refreshRequest(deviceBToken), db, JWT_SECRET);
    expect(deviceB.user).toEqual({ userId: "u1", email: "u1@example.com" });
  });

  it("reports no success when the spent-row delete fails, and keeps both deletes together", async () => {
    // The two deletes share a transaction, so a failure on the second cannot
    // leave the first applied — which would report a clean logout while the
    // graced token it missed stayed usable.
    const { POST } = await import("./route");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw, "u1");
    const { liveToken, spentHash } = await rotateOnce(raw, "u1", "device-a");
    const liveHash = await sha256(liveToken);

    const db = withFailingStatement(raw, { match: "rotated_at IS NOT NULL" });
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    await expect(POST(refreshRequest(liveToken))).rejects.toThrow("D1_ERROR: injected failure");

    // Without this the row assertions below are also true of a run that never failed.
    expect(injectedFailureCount(db)).toBe(1);

    const { results } = await sessionRows(raw);
    expect(results.map((row) => row.token_hash)).toEqual([spentHash, liveHash].sort());
  });

  it("succeeds without a refresh cookie", async () => {
    const { POST } = await import("./route");
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const response = await POST(
      new NextRequest("https://example.com/api/auth/logout", { method: "POST" })
    );

    expect(response.status).toBe(200);
    const cleared = response.headers.getSetCookie();
    expect(cleared.length).toBe(2);
    for (const cookie of cleared) expect(cookie).toContain("Max-Age=0");
  });

  it("succeeds and clears cookies for a refresh token with no session row", async () => {
    const { POST } = await import("./route");
    const db = createFakeD1(loadMigration());
    vi.mocked(getCloudflareContext).mockResolvedValue({ env: fakeEnv(db), ctx: {} } as never);

    const response = await POST(refreshRequest("never-issued-token"));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().length).toBe(2);
  });
});
