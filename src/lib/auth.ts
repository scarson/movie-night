// ABOUTME: Auth utility functions for JWT, session management, and request authentication.
// ABOUTME: Central auth module used by all authenticated API route handlers.

import { SignJWT, jwtVerify, decodeJwt } from "jose";
import { NextRequest } from "next/server";

const COOKIE_SESSION = "mn-session";
const COOKIE_REFRESH = "mn-refresh";
export const REFRESH_EXPIRY_DAYS = 90;

/**
 * How long a rotated refresh token still authenticates its bearer, without
 * issuing cookies. A client fans several authenticated requests out at once
 * (/ritual sends three), so all but one arrive holding a token another request
 * has already spent; they cannot be handed the replacement, because it exists
 * only as a hash here and as plaintext in the winner's Set-Cookie.
 */
const ROTATION_GRACE_MS = 30_000;

// ── Pure helpers ──────────────────────────────────────────────

/** SHA-256 hash a string, return hex. Used to hash refresh tokens before storing in D1. */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sign a JWT with { userId, email } claims. Expires in 15 minutes. */
export async function createJWT(
  payload: { userId: string; email: string },
  secret: string
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .setIssuedAt()
    .sign(key);
}

/** Verify a JWT and return claims, or null if invalid/expired. */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

/** Re-export decodeJwt for use in OAuth callback (decodes Google's ID token without verification). */
export { decodeJwt };

/** Validate a returnTo URL to prevent open redirects. Must start with / but not //. No backslashes. */
export function validateReturnTo(returnTo: string | null): string {
  if (
    !returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\")
  ) {
    return "/";
  }
  return returnTo;
}

// ── Session lifecycle ────────────────────────────────────────

/** How many places one account may be signed in at once. */
export const MAX_SESSIONS = 10;

/**
 * Drop the least recently created sign-ins beyond MAX_SESSIONS.
 *
 * The cap counts sign-ins, not rows. A row a rotation has spent is a tombstone
 * its replacement already superseded, waiting to be pruned; counting one costs
 * the account a place it is not occupying, and evicting one spends an eviction
 * that should have fallen on a real sign-in. Both halves have to read the same
 * population or the cap stops binding: the tombstone is older than the sign-ins
 * it sits beside, so an unfiltered delete answers a filtered count by removing
 * the tombstone and leaving every sign-in in place. Rotation clears its own
 * tombstones on the account's next refresh.
 */
export async function enforceSessionLimit(db: D1Database, userId: string): Promise<void> {
  const countRow = await db
    .prepare("SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND rotated_at IS NULL")
    .bind(userId)
    .first<{ count: number }>();

  const excess = (countRow?.count ?? 0) - MAX_SESSIONS;
  if (excess <= 0) return;

  await db
    .prepare(
      "DELETE FROM sessions WHERE token_hash IN " +
        "(SELECT token_hash FROM sessions WHERE user_id = ? AND rotated_at IS NULL " +
        "ORDER BY created_at ASC LIMIT ?)"
    )
    .bind(userId, excess)
    .run();
}

// ── Request authentication ───────────────────────────────────

/**
 * Authenticate an incoming request via JWT cookie.
 * If the JWT is expired but a valid refresh token exists, rotates both tokens.
 * Callers MUST merge the returned headers into their response (they may contain Set-Cookie).
 */
export async function authenticateRequest(
  request: NextRequest,
  db: D1Database,
  jwtSecret: string
): Promise<{
  user: { userId: string; email: string } | null;
  headers: Headers;
}> {
  const headers = new Headers();
  const sessionCookie = request.cookies.get(COOKIE_SESSION)?.value;
  const refreshCookie = request.cookies.get(COOKIE_REFRESH)?.value;
  const isSecure = request.url.startsWith("https://");

  // A valid session cookie is the fast path. When it's absent, fall through to
  // refresh: the session cookie's Max-Age is tied to the 15m JWT, so a browser
  // that has passed that window sends only mn-refresh, and rotation must still
  // work from that state (otherwise the 90-day refresh token is unreachable).
  if (sessionCookie) {
    const user = await verifyJWT(sessionCookie, jwtSecret);
    if (user) {
      return { user, headers };
    }
  }

  // JWT missing/invalid/expired — try refresh
  if (!refreshCookie) {
    // Nothing to authenticate with. Only clear cookies if the client sent an
    // (invalid) session cookie; a request with no auth cookies at all needs no
    // Set-Cookie churn.
    if (sessionCookie) clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  const tokenHash = await sha256(refreshCookie);

  // Everything that can fail is read before anything is written. A throw
  // between destroying the session and re-creating it would leave the caller
  // holding a token with no row, and this function runs before every route's
  // own try block, so nothing downstream could clear the dead cookies.
  const session = await db
    .prepare(
      "SELECT s.user_id, s.expires_at, s.rotated_at, u.email " +
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?"
    )
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string; rotated_at: string | null; email: string }>();

  if (!session) {
    // The token was never valid, or its session is long gone. Don't clear
    // cookies: a concurrent request that just rotated has already set new ones.
    return { user: null, headers };
  }

  const user = { userId: session.user_id, email: session.email };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  if (new Date(session.expires_at).getTime() < nowMs) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    clearAuthCookies(headers, isSecure);
    return { user: null, headers };
  }

  const newRefreshToken = crypto.randomUUID();
  const newTokenHash = await sha256(newRefreshToken);
  const expiresAt = new Date(
    nowMs + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // One transaction, so the replacement and the mark that spends the old token
  // either both land or neither does. The INSERT sources user_id from the row
  // itself rather than from a RETURNING clause, which a later statement in a
  // batch cannot read. Both predicates are identical: were they to differ, a
  // row expiring between the read above and this batch could mark a rotation
  // that inserted nothing, minting a cookie for a session that does not exist.
  const claim = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) " +
          "SELECT ?, user_id, ?, ? FROM sessions " +
          "WHERE token_hash = ? AND rotated_at IS NULL AND expires_at > ?"
      )
      .bind(newTokenHash, expiresAt, now, tokenHash, now),
    db
      .prepare(
        "UPDATE sessions SET rotated_at = ? " +
          "WHERE token_hash = ? AND rotated_at IS NULL AND expires_at > ?"
      )
      .bind(now, tokenHash, now),
  ]);

  const issued = claim[0].meta.changes ?? 0;
  const spent = claim[1].meta.changes ?? 0;
  if (issued !== spent) {
    throw new Error("Session rotation claim was inconsistent");
  }

  if (issued === 0) {
    // Another request spent this token. It cannot be handed the replacement —
    // the plaintext exists only in that request's Set-Cookie — so it
    // authenticates on the strength of the token it presented and sends no
    // cookies of its own, leaving the winner's in place. Re-read rather than
    // trusting the rotated_at from the read above: that read happened before
    // the winning UPDATE, so it says NULL in exactly the case this branch is for.
    const rotated = await db
      .prepare("SELECT rotated_at, expires_at FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ rotated_at: string | null; expires_at: string }>();

    const withinGrace =
      rotated?.rotated_at != null &&
      new Date(rotated.expires_at).getTime() > nowMs &&
      nowMs - new Date(rotated.rotated_at).getTime() < ROTATION_GRACE_MS;

    return { user: withinGrace ? user : null, headers };
  }

  // Spent tokens outlive their grace window by nothing. Scoped to this user so
  // it rides idx_sessions_user, and kept out of the batch so that failing to
  // tidy up never rolls back the rotation it follows.
  try {
    await db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND rotated_at IS NOT NULL AND rotated_at < ?")
      .bind(session.user_id, new Date(nowMs - ROTATION_GRACE_MS).toISOString())
      .run();
  } catch {
    // Nothing to do: the rows are spent either way.
  }

  const newJwt = await createJWT(user, jwtSecret);
  setAuthCookies(headers, newJwt, newRefreshToken, isSecure);

  return { user, headers };
}

// ── Cookie helpers ───────────────────────────────────────────

function cookieOptions(isSecure: boolean): string {
  return `HttpOnly; SameSite=Lax; Path=/${isSecure ? "; Secure" : ""}`;
}

export function setAuthCookies(
  headers: Headers,
  jwt: string,
  refreshToken: string,
  isSecure: boolean
): void {
  const opts = cookieOptions(isSecure);
  headers.append(
    "Set-Cookie",
    `${COOKIE_SESSION}=${jwt}; Max-Age=900; ${opts}`
  );
  headers.append(
    "Set-Cookie",
    `${COOKIE_REFRESH}=${refreshToken}; Max-Age=${REFRESH_EXPIRY_DAYS * 24 * 60 * 60}; ${opts}`
  );
}

export function clearAuthCookies(
  headers: Headers,
  isSecure: boolean
): void {
  const opts = cookieOptions(isSecure);
  headers.append(
    "Set-Cookie",
    `${COOKIE_SESSION}=; Max-Age=0; ${opts}`
  );
  headers.append(
    "Set-Cookie",
    `${COOKIE_REFRESH}=; Max-Age=0; ${opts}`
  );
}
