// ABOUTME: POST /api/groups/join — join a group by invite code. Code format is validated
// ABOUTME: before any DB hit; join attempts are rate-limited per user to slow code enumeration.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { checkJoinRateLimit, logJoinAttempt, joinGroup } from "@/lib/groups";

const CODE_FORMAT = /^[2-9A-Za-z]{8}$/;

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const response = NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }

  const code = typeof (body as { code?: unknown } | null)?.code === "string" ? (body as { code: string }).code : "";

  // Format check happens before any DB access — a malformed code can never match a
  // real invite code (see src/lib/groups.ts's alphabet note), so it costs nothing to
  // reject up front and never touches the rate-limit or groups tables.
  if (!CODE_FORMAT.test(code)) {
    const response = NextResponse.json({ error: "Invalid invite code format" }, { status: 400 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }

  try {
    const allowed = await checkJoinRateLimit(db, user.userId);
    if (!allowed) {
      const response = NextResponse.json(
        { error: "Too many join attempts — try again later" },
        { status: 429 }
      );
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }

    // Logged for every well-formatted code, whether or not it matches a real group —
    // this is what rate-limits invite-code enumeration, not just successful joins.
    await logJoinAttempt(db, user.userId);

    const group = await joinGroup(db, user.userId, code);
    if (!group) {
      const response = NextResponse.json({ error: "That code didn't match a group" }, { status: 404 });
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }

    // Success response is id + name ONLY — no member list/PII before the user has
    // actually joined.
    const response = NextResponse.json({ id: group.id, name: group.name });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("POST /api/groups/join:", err);
    const response = NextResponse.json({ error: "Failed to join group" }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
