// ABOUTME: GET /api/groups — list the caller's groups. POST /api/groups — create a group.
// ABOUTME: Group name is trimmed and validated (1-50 chars) here; reserved-name rejection lives in the lib.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { createGroup, getGroupsForUser, ReservedGroupNameError } from "@/lib/groups";

const MAX_GROUP_NAME_LENGTH = 50;

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const groups = await getGroupsForUser(db, user.userId);
    const response = NextResponse.json({ groups });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    console.error("GET /api/groups:", err);
    const response = NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}

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

  const rawName = (body as { name?: unknown } | null)?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length === 0 || name.length > MAX_GROUP_NAME_LENGTH) {
    const response = NextResponse.json(
      { error: `Group name must be 1-${MAX_GROUP_NAME_LENGTH} characters` },
      { status: 400 }
    );
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }

  try {
    const group = await createGroup(db, user.userId, name);
    const response = NextResponse.json({ group });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  } catch (err) {
    if (err instanceof ReservedGroupNameError) {
      const response = NextResponse.json({ error: err.message }, { status: 400 });
      headers.forEach((value, key) => response.headers.append(key, value));
      return response;
    }
    console.error("POST /api/groups:", err);
    const response = NextResponse.json({ error: "Failed to create group" }, { status: 500 });
    headers.forEach((value, key) => response.headers.append(key, value));
    return response;
  }
}
