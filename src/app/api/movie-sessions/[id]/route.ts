// ABOUTME: GET /api/movie-sessions/[id] — member-only session state for reload:
// ABOUTME: session view (own rough-day flag only) + latest round + hydrated titles map.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { parseJsonColumn } from "@/lib/db";
import { getSessionForMember, getTitlesMap } from "@/lib/movie-sessions";
import { isMatchingResponse } from "@/lib/matching";
import type { MatchingResponse } from "@/types/matching";
import type { RecommendationRow } from "@/types/db";

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const { id } = await params;

  try {
    const session = await getSessionForMember(db, id, user.userId);
    if (!session) {
      return withAuthHeaders(NextResponse.json({ error: "Session not found" }, { status: 404 }), headers);
    }

    // Named columns, not *: the row also carries candidate_snapshot, the whole
    // pool the round was chosen from, which nothing below this reads.
    const latest = await db
      .prepare(
        "SELECT round_number, ai_response FROM recommendations WHERE session_id = ? ORDER BY round_number DESC LIMIT 1"
      )
      .bind(id)
      .first<Pick<RecommendationRow, "round_number" | "ai_response">>();

    let response: MatchingResponse | null = null;
    if (latest) {
      // The guard runs against `parsed` including when it is null, so a blob
      // that is not JSON at all is logged too — that is the commonest
      // corruption, and the renderer dereferences this value immediately.
      const parsed = parseJsonColumn<unknown>(latest.ai_response, null);
      if (isMatchingResponse(parsed)) {
        response = parsed;
      } else {
        console.error(
          JSON.stringify({ event: "corrupt_ai_response", session_id: id, round: latest.round_number })
        );
      }
    }

    const titles = response
      ? await getTitlesMap(db, response.recommendations.map((rec) => rec.tmdbId))
      : {};

    return withAuthHeaders(
      NextResponse.json({
        session,
        round: latest?.round_number ?? 0,
        response,
        titles,
      }),
      headers
    );
  } catch (err) {
    console.error("GET /api/movie-sessions/[id]:", err);
    return withAuthHeaders(NextResponse.json({ error: "Failed to fetch session" }, { status: 500 }), headers);
  }
}
