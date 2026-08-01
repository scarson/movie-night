// ABOUTME: Tests for auth utility functions — JWT, hashing, cookies, and request authentication.
// ABOUTME: Covers pure helpers and authenticateRequest with the fake-D1 helper for session rotation.

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createFakeD1,
  injectedFailureCount,
  loadMigration,
  withFailingStatement,
} from "@/test/fake-d1";

function seedUser(db: D1Database, overrides: Partial<{ id: string; googleId: string; email: string; name: string }> = {}) {
  const { id = "u1", googleId = "g1", email = "a@b.com", name = "Sam" } = overrides;
  return db
    .prepare("INSERT INTO users (id, google_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, googleId, email, name, "2026-01-01T00:00:00.000Z")
    .run();
}

function seedSession(
  db: D1Database,
  overrides: Partial<{ tokenHash: string; userId: string; expiresAt: string }> = {}
) {
  const {
    tokenHash = "hash1",
    userId = "u1",
    expiresAt = new Date(Date.now() + 86400000).toISOString(),
  } = overrides;
  return db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, expiresAt, "2026-01-01T00:00:00.000Z")
    .run();
}

function sessionRows(db: D1Database, userId: string) {
  return db
    .prepare("SELECT token_hash, rotated_at, expires_at FROM sessions WHERE user_id = ? ORDER BY token_hash")
    .bind(userId)
    .all<{ token_hash: string; rotated_at: string | null; expires_at: string }>();
}

/**
 * Delegates to a fake D1, running `hook` against the same database immediately
 * after the first execution of a statement whose SQL contains `match`. It places
 * a competing write at one named seam inside the code under test, and reports
 * whether that seam was ever reached.
 *
 * This is NOT a concurrency harness. `src/test/fake-d1.ts` is backed by
 * node:sqlite's synchronous `DatabaseSync`, so two callers cannot interleave —
 * see docs/pitfalls/testing-pitfalls.md §5. What a seam proves is narrower and
 * still worth proving: which version of a row a later branch reads when the row
 * changed after that branch's own earlier read of it. Whether two HTTP requests
 * genuinely reach the seam together is not provable here.
 *
 * `firedCount` exists for the same reason `injectedFailureCount` does: a `match`
 * that never matches writes nothing, and every assertion downstream of it is
 * then just the happy path. Assert it.
 */
function withWriteAfter(
  db: D1Database,
  match: string,
  hook: () => Promise<void>
): { db: D1Database; firedCount: () => number } {
  let fired = 0;

  const after = async (sql: string): Promise<void> => {
    if (fired > 0 || !sql.includes(match)) return;
    fired += 1;
    await hook();
  };

  class SeamedStatement {
    constructor(
      private readonly inner: D1PreparedStatement,
      private readonly sql: string
    ) {}

    bind(...values: unknown[]): D1PreparedStatement {
      return new SeamedStatement(this.inner.bind(...values), this.sql) as unknown as D1PreparedStatement;
    }

    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const row =
        colName === undefined ? await this.inner.first<T>() : await this.inner.first<T>(colName);
      await after(this.sql);
      return row;
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const result = await this.inner.all<T>();
      await after(this.sql);
      return result;
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const result = await this.inner.run<T>();
      await after(this.sql);
      return result;
    }

    async raw<T = unknown[]>(): Promise<T[]> {
      const rows = await this.inner.raw<T>();
      await after(this.sql);
      return rows;
    }
  }

  const seamed = {
    prepare(sql: string): D1PreparedStatement {
      return new SeamedStatement(db.prepare(sql), sql) as unknown as D1PreparedStatement;
    },
    batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return db.batch<T>(statements);
    },
  };

  return { db: seamed as unknown as D1Database, firedCount: () => fired };
}

// ── Pure function tests ──────────────────────────────────────

describe("sha256", () => {
  it("matches the known SHA-256 test vector for 'abc'", async () => {
    const { sha256 } = await import("./auth");
    const hash = await sha256("abc");
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns a consistent 64-character hex string", async () => {
    const { sha256 } = await import("./auth");
    const hash = await sha256("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256("hello")).toBe(hash);
  });
});

describe("createJWT", () => {
  it("returns a string with 3 dot-separated parts", async () => {
    const { createJWT } = await import("./auth");
    const token = await createJWT(
      { userId: "u1", email: "a@b.com" },
      "test-secret-that-is-at-least-32-chars-long"
    );
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("verifyJWT", () => {
  const secret = "test-secret-that-is-at-least-32-chars-long";

  it("returns { userId, email } for a valid token", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const result = await verifyJWT(token, secret);
    expect(result).toEqual({ userId: "u1", email: "a@b.com" });
  });

  it("returns null for an expired token", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    vi.useFakeTimers();
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes past 15-min expiry
    const result = await verifyJWT(token, secret);
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("returns null for a token signed with wrong secret", async () => {
    const { createJWT, verifyJWT } = await import("./auth");
    const token = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const result = await verifyJWT(token, "wrong-secret-that-is-at-least-32-chars");
    expect(result).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const { verifyJWT } = await import("./auth");
    const result = await verifyJWT("garbage", secret);
    expect(result).toBeNull();
  });

  it("rejects a JWT with alg: none", async () => {
    const { verifyJWT } = await import("./auth");
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=/g, "");
    const payload = btoa(
      JSON.stringify({ userId: "u1", email: "a@b.com", exp: Math.floor(Date.now() / 1000) + 3600 })
    ).replace(/=/g, "");
    const noneToken = `${header}.${payload}.`;

    const result = await verifyJWT(noneToken, secret);
    expect(result).toBeNull();
  });
});

describe("validateReturnTo", () => {
  it("accepts a valid relative path", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/groups/join/AB23CDEF")).toBe("/groups/join/AB23CDEF");
  });

  it("accepts root path", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/")).toBe("/");
  });

  it("rejects protocol-relative URLs", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("//evil.com")).toBe("/");
  });

  it("rejects absolute URLs", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("http://evil.com")).toBe("/");
  });

  it("rejects paths with backslashes", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("/path\\with\\backslash")).toBe("/");
  });

  it("returns / for null", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo(null)).toBe("/");
  });

  it("returns / for empty string", async () => {
    const { validateReturnTo } = await import("./auth");
    expect(validateReturnTo("")).toBe("/");
  });
});

// ── authenticateRequest tests ────────────────────────────────

function makeRequest(
  cookies: Record<string, string> = {},
  url = "https://example.com/api/test"
): NextRequest {
  const req = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("authenticateRequest", () => {
  const secret = "test-secret-that-is-at-least-32-chars-long";

  it("returns user for a valid JWT", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    const req = makeRequest({ "mn-session": jwt });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });
    // No Set-Cookie headers needed when JWT is still valid
    expect(result.headers.has("Set-Cookie")).toBe(false);
  });

  it("rotates tokens when JWT is expired but refresh token is valid", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // expire the JWT

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(db, { tokenHash, userId: "u1" });

    const req = makeRequest({
      "mn-session": jwt,
      "mn-refresh": refreshToken,
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });

    // Should have Set-Cookie headers for rotated tokens
    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("mn-session=");
    expect(setCookies[1]).toContain("mn-refresh=");

    // The spent token is marked rotated rather than removed: the row is what
    // lets a concurrent loser of the claim still authenticate.
    const oldSession = await db
      .prepare("SELECT rotated_at FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ rotated_at: string | null }>();
    expect(oldSession?.rotated_at).toBe(new Date().toISOString());

    // Exactly one replacement, and it is unrotated.
    const { results: sessionsForUser } = await sessionRows(db, "u1");
    expect(sessionsForUser.length).toBe(2);
    expect(sessionsForUser.filter((row) => row.rotated_at === null).length).toBe(1);

    vi.useRealTimers();
  });

  it("rotates tokens when only the refresh cookie is present (session cookie already expired)", async () => {
    // A real browser deletes mn-session at its Max-Age (tied to the JWT's 15m
    // lifetime) and sends only mn-refresh afterward. The refresh path must be
    // reachable from that state, or the 90-day refresh token is dead weight.
    const { authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(db, { tokenHash, userId: "u1" });

    const req = makeRequest({ "mn-refresh": refreshToken });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });

    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("mn-session=");
    expect(setCookies[1]).toContain("mn-refresh=");

    const oldSession = await db
      .prepare("SELECT rotated_at FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ rotated_at: string | null }>();
    // typeof, not not.toBeNull(): a deleted row reads back as undefined, which
    // would satisfy not.toBeNull() and hide exactly the behavior under test.
    expect(typeof oldSession?.rotated_at).toBe("string");
  });

  it("returns null with no cookies at all", async () => {
    const { authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());
    const result = await authenticateRequest(makeRequest({}), db, secret);
    expect(result.user).toBeNull();
  });

  it("clears cookies when JWT is expired and refresh token is expired in D1", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const refreshToken = "expired-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(db, {
      tokenHash,
      userId: "u1",
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
    });

    const req = makeRequest({
      "mn-session": jwt,
      "mn-refresh": refreshToken,
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("Max-Age=0");
    expect(setCookies[1]).toContain("Max-Age=0");

    vi.useRealTimers();
  });

  it("returns null when JWT is expired and no refresh cookie exists", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const req = makeRequest({ "mn-session": jwt });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    const setCookies = result.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("Max-Age=0");

    vi.useRealTimers();
  });

  it("returns null when no session cookie exists", async () => {
    const { authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());

    const req = makeRequest({});
    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();
    expect(result.headers.has("Set-Cookie")).toBe(false);
  });

  it("returns null for malformed session cookie", async () => {
    const { authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());

    const req = makeRequest({ "mn-session": "not-a-jwt" });
    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();
  });

  it("sets Secure flag on cookies when request is HTTPS", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const refreshToken = "refresh-token";
    await seedSession(db, { tokenHash: await sha256(refreshToken), userId: "u1" });

    const req = makeRequest(
      { "mn-session": jwt, "mn-refresh": refreshToken },
      "https://example.com/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
    }

    vi.useRealTimers();
  });

  it("omits Secure flag on cookies when request is HTTP", async () => {
    const { createJWT, authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000);

    const refreshToken = "refresh-token";
    await seedSession(db, { tokenHash: await sha256(refreshToken), userId: "u1" });

    const req = makeRequest(
      { "mn-session": jwt, "mn-refresh": refreshToken },
      "http://localhost:3000/api/test"
    );
    const result = await authenticateRequest(req, db, secret);

    const cookies = result.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("Secure");
    }

    vi.useRealTimers();
  });

  it("returns null without clearing cookies when the refresh token was never valid", async () => {
    const { createJWT, authenticateRequest } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const jwt = await createJWT({ userId: "u1", email: "a@b.com" }, secret);
    vi.advanceTimersByTime(16 * 60 * 1000); // expire the JWT

    // No session row was ever inserted for this refresh token.
    const req = makeRequest({
      "mn-session": jwt,
      "mn-refresh": "never-issued-refresh-token",
    });

    const result = await authenticateRequest(req, db, secret);
    expect(result.user).toBeNull();

    // CRITICAL: must NOT clear cookies — a winning concurrent request may
    // already have set new ones.
    expect(result.headers.has("Set-Cookie")).toBe(false);

    vi.useRealTimers();
  });

  it("a second authenticateRequest against an already-rotated session authenticates the user and issues no cookies", async () => {
    // SEQUENTIAL, not concurrent (docs/pitfalls/testing-pitfalls.md §5): the
    // fake D1 is synchronous, so this calls twice in a row rather than racing.
    // It proves the outcome the loser of a claim is given — the user, and no
    // Set-Cookie, because the winner's cookies are the ones the client keeps.
    // It does NOT prove that two requests can reach the claim together.
    const { authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(db, { tokenHash, userId: "u1" });

    // Only mn-refresh: past its Max-Age the browser has dropped mn-session, and
    // that is the state every rotation actually runs in (testing-pitfalls §7).
    const winner = await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);
    expect(winner.headers.getSetCookie().length).toBe(2);

    const { results: afterWinner } = await sessionRows(db, "u1");

    const loser = await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);
    expect(loser.user).toEqual({ userId: "u1", email: "a@b.com" });
    expect(loser.headers.has("Set-Cookie")).toBe(false);

    // No second token: minting one per loser would leave a /ritual fan-out with
    // three unreferenced 90-day refresh tokens.
    const { results: afterLoser } = await sessionRows(db, "u1");
    expect(afterLoser).toEqual(afterWinner);
  });

  it("authenticates a caller whose claim was taken between its own read and its claim, and issues it no cookies", async () => {
    // The discriminating case for the grace check. The competing rotation lands
    // AFTER this caller has already read the row, so the rotated_at it read is
    // null — deciding the grace window from that value sends the caller to a
    // 401 and leaves B1 unfixed, while the sequential test above passes either
    // way. Placing the write at that exact seam is a deterministic interleaving,
    // not a race (testing-pitfalls §5); it pins which read the branch trusts.
    const { authenticateRequest, sha256 } = await import("./auth");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(raw, { tokenHash, userId: "u1" });

    const rotateAsWinner = async () => {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
      await raw.batch([
        raw
          .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
          .bind("winners-token-hash", "u1", expiresAt, now),
        raw.prepare("UPDATE sessions SET rotated_at = ? WHERE token_hash = ?").bind(now, tokenHash),
      ]);
    };

    const { db, firedCount } = withWriteAfter(raw, "SELECT s.user_id", rotateAsWinner);

    const result = await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);

    // Without this the whole test is the happy path wearing a costume.
    expect(firedCount()).toBe(1);
    expect(result.user).toEqual({ userId: "u1", email: "a@b.com" });
    expect(result.headers.has("Set-Cookie")).toBe(false);

    // The caller that lost minted nothing: the winner's row and the spent one.
    const { results } = await sessionRows(raw, "u1");
    expect(results.map((row) => row.token_hash)).toEqual(["winners-token-hash", tokenHash].sort());
  });

  it("issues no cookies when the session expires between the read and the claim", async () => {
    // Both claim statements carry the same predicate, so a row that reaches its
    // expiry inside this seam satisfies neither. A looser predicate on the mark
    // would report a rotation the insert never made, and the caller would leave
    // holding a refresh cookie whose hash has no sessions row — the permanent
    // 401 this change exists to remove, reintroduced by the fix for it.
    const { authenticateRequest, sha256 } = await import("./auth");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(raw, { tokenHash, userId: "u1" });

    const expireTheSession = async () => {
      await raw
        .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
        .bind(new Date(Date.now() - 1000).toISOString(), tokenHash)
        .run();
    };

    const { db, firedCount } = withWriteAfter(raw, "SELECT s.user_id", expireTheSession);

    const result = await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);

    expect(firedCount()).toBe(1);
    expect(result.user).toBeNull();
    expect(result.headers.has("Set-Cookie")).toBe(false);

    // Nothing was minted, and nothing was marked as spent.
    const { results } = await sessionRows(raw, "u1");
    expect(results.map((row) => row.token_hash)).toEqual([tokenHash]);
    expect(results[0].rotated_at).toBeNull();
  });

  it("returns null without clearing cookies once the rotation grace window has elapsed", async () => {
    // The null this asserts is also what the code returned before the grace
    // window existed, so on its own it is a boundary guard rather than a
    // regression test. What it does pin is the far end of the window: paired
    // with the two tests above, a later widening has to move a test.
    const { authenticateRequest, sha256 } = await import("./auth");
    const db = createFakeD1(loadMigration());
    await seedUser(db);

    vi.useFakeTimers();
    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(db, { tokenHash, userId: "u1" });

    await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);
    vi.advanceTimersByTime(31_000); // past the 30-second grace window

    // The spent row must still be here, or the null below comes from the
    // never-valid branch and the window itself is never evaluated.
    const { results: spent } = await sessionRows(db, "u1");
    const spentRow = spent.find((row) => row.token_hash === tokenHash);
    expect(typeof spentRow?.rotated_at).toBe("string");

    const result = await authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret);
    expect(result.user).toBeNull();
    expect(result.headers.has("Set-Cookie")).toBe(false);

    vi.useRealTimers();
  });

  it("leaves the original session usable when the replacement insert fails", async () => {
    const { authenticateRequest, sha256 } = await import("./auth");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(raw, { tokenHash, userId: "u1" });

    const db = withFailingStatement(raw, { match: "INSERT INTO sessions" });

    await expect(
      authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret)
    ).rejects.toThrow("D1_ERROR: injected failure");

    // Without this the surviving-row assertions below are also true of a run
    // where nothing failed at all.
    expect(injectedFailureCount(db)).toBe(1);

    // The blip is transient: the caller's next request finds its session intact.
    const { results } = await sessionRows(raw, "u1");
    expect(results.map((row) => row.token_hash)).toEqual([tokenHash]);
    expect(results[0].rotated_at).toBeNull();
  });

  it("leaves the original session usable when the rotation mark fails", async () => {
    // The atomicity assertion: the replacement insert has already succeeded when
    // this statement throws, so only a rolled-back batch can leave one row.
    const { authenticateRequest, sha256 } = await import("./auth");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(raw, { tokenHash, userId: "u1" });

    const db = withFailingStatement(raw, { match: "UPDATE sessions SET rotated_at" });

    await expect(
      authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret)
    ).rejects.toThrow("D1_ERROR: injected failure");
    expect(injectedFailureCount(db)).toBe(1);

    const { results } = await sessionRows(raw, "u1");
    expect(results.map((row) => row.token_hash)).toEqual([tokenHash]);
    expect(results[0].rotated_at).toBeNull();
  });

  it("leaves the original session usable when the pre-rotation read fails", async () => {
    const { authenticateRequest, sha256 } = await import("./auth");
    const raw = createFakeD1(loadMigration());
    await seedUser(raw);

    const refreshToken = "valid-refresh-token";
    const tokenHash = await sha256(refreshToken);
    await seedSession(raw, { tokenHash, userId: "u1" });

    const db = withFailingStatement(raw, { match: "SELECT s.user_id" });

    await expect(
      authenticateRequest(makeRequest({ "mn-refresh": refreshToken }), db, secret)
    ).rejects.toThrow("D1_ERROR: injected failure");
    expect(injectedFailureCount(db)).toBe(1);

    const { results } = await sessionRows(raw, "u1");
    expect(results.map((row) => row.token_hash)).toEqual([tokenHash]);
    expect(results[0].rotated_at).toBeNull();
  });
});
