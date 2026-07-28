// ABOUTME: POST /api/movie-sessions — creates a movie session (group or solo-on-demand)
// ABOUTME: with per-member rough-day flags; membership is verified unconditionally.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { createMovieSession, NotGroupMemberError } from "@/lib/movie-sessions";

const MAX_TAG_CHARS = 30;
const MAX_TAG_LIST_ENTRIES = 30;
const MAX_MOOD_TEXT_CHARS = 200;

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

function validateBody(body: Record<string, unknown>): string | null {
  if (body.groupId !== null && body.groupId !== undefined && typeof body.groupId !== "string") {
    return "groupId must be a string or null";
  }
  if (!Array.isArray(body.moodVibes)) return "moodVibes must be an array";
  if (body.moodVibes.length > MAX_TAG_LIST_ENTRIES) {
    return `moodVibes can hold at most ${MAX_TAG_LIST_ENTRIES} tags`;
  }
  if (!body.moodVibes.every((tag) => typeof tag === "string" && tag.length <= MAX_TAG_CHARS)) {
    return `moodVibes entries must be strings of at most ${MAX_TAG_CHARS} characters`;
  }
  if (typeof body.moodText !== "string" || body.moodText.length > MAX_MOOD_TEXT_CHARS) {
    return `moodText must be a string of at most ${MAX_MOOD_TEXT_CHARS} characters`;
  }
  for (const field of ["discoverNew", "isQuickMatch", "roughDay"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      return `${field} must be a boolean`;
    }
  }
  if (body.memberFlags !== undefined) {
    if (body.memberFlags === null || typeof body.memberFlags !== "object" || Array.isArray(body.memberFlags)) {
      return "memberFlags must be an object";
    }
    for (const value of Object.values(body.memberFlags as Record<string, unknown>)) {
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as Record<string, unknown>).roughDay !== "boolean"
      ) {
        return "memberFlags values must be { roughDay: boolean }";
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("body must be a JSON object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return withAuthHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }), headers);
  }

  const validationError = validateBody(body);
  if (validationError) {
    return withAuthHeaders(NextResponse.json({ error: validationError }, { status: 400 }), headers);
  }

  try {
    const { sessionId } = await createMovieSession(db, {
      userId: user.userId,
      groupId: (body.groupId as string | null | undefined) ?? null,
      moodVibes: body.moodVibes as string[],
      moodText: body.moodText as string,
      discoverNew: (body.discoverNew as boolean | undefined) ?? false,
      isQuickMatch: (body.isQuickMatch as boolean | undefined) ?? false,
      roughDay: (body.roughDay as boolean | undefined) ?? false,
      memberFlags: body.memberFlags as Record<string, { roughDay: boolean }> | undefined,
    });
    return withAuthHeaders(NextResponse.json({ sessionId }), headers);
  } catch (err) {
    if (err instanceof NotGroupMemberError) {
      return withAuthHeaders(
        NextResponse.json({ error: "You're not a member of this group" }, { status: 403 }),
        headers
      );
    }
    console.error("POST /api/movie-sessions:", err);
    return withAuthHeaders(NextResponse.json({ error: "Failed to create session" }, { status: 500 }), headers);
  }
}
