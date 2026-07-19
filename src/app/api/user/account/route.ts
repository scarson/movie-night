// ABOUTME: DELETE /api/user/account — deletes the authenticated user's account.
// ABOUTME: Shared session_members/movie_sessions records are anonymized, not cascaded; clears auth cookies on success.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest, clearAuthCookies } from "@/lib/auth";
import { deleteAccount } from "@/lib/account";

export async function DELETE(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const isSecure = request.url.startsWith("https://");
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    await deleteAccount(db, user.userId);

    clearAuthCookies(headers, isSecure);

    const response = NextResponse.json({ ok: true });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("DELETE /api/user/account:", err);
    const response = NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
