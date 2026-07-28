// ABOUTME: GET /api/groups/[id] — member-only group detail (members with names/avatars).
// ABOUTME: Non-members and nonexistent groups both 404, so existence is never leaked.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { getGroupDetailForMember } from "@/lib/groups";

export async function GET(
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
    const group = await getGroupDetailForMember(db, user.userId, id);

    if (!group) {
      const response = NextResponse.json({ error: "Group not found" }, { status: 404 });
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }

    const response = NextResponse.json({ group });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("GET /api/groups/[id]:", err);
    const response = NextResponse.json({ error: "Failed to fetch group" }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
