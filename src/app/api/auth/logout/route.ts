// ABOUTME: POST /api/auth/logout — destroys the user's session and clears auth cookies.
// ABOUTME: Always returns 200 regardless of auth state to ensure clean client-side logout.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256, clearAuthCookies } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const isSecure = request.url.startsWith("https://");
  const headers = new Headers();

  const refreshToken = request.cookies.get("mn-refresh")?.value;
  if (refreshToken) {
    const tokenHash = await sha256(refreshToken);
    const session = await db
      .prepare("SELECT user_id FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ user_id: string }>();

    if (session) {
      // Rotation leaves the token it spent authenticating for a grace window, so
      // deleting only the presented one would let the credential the user just
      // revoked keep working for the rest of that window. Both deletes share one
      // batch — a transaction — so a partial failure cannot report a clean logout
      // while leaving a graced token behind.
      //
      // Scoped to spent rows of this user: they are unusable outside their grace
      // window, so removing them cannot disturb a session another device is
      // actively holding, which deleting every row for the user would.
      //
      // Known edge, accepted: another device that just lost a rotation race and
      // is inside its own grace window gets a 401 on its next request and
      // re-authenticates. An explicit logout should invalidate aggressively.
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash),
        db
          .prepare("DELETE FROM sessions WHERE user_id = ? AND rotated_at IS NOT NULL")
          .bind(session.user_id),
      ]);
    }
  }

  clearAuthCookies(headers, isSecure);

  const response = NextResponse.json({ ok: true });
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}
