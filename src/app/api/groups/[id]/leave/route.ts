// ABOUTME: POST /api/groups/[id]/leave — removes the caller's own group membership.
// ABOUTME: Idempotent: succeeds even if the caller was never a member of the group.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { leaveGroup } from "@/lib/groups";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const { id } = await params;
    await leaveGroup(db, user.userId, id);

    const response = NextResponse.json({ ok: true });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("POST /api/groups/[id]/leave:", err);
    const response = NextResponse.json({ error: "Failed to leave group" }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
