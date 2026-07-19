// ABOUTME: GET /api/titles/search?q= — local-catalog-first title search with wildcard
// ABOUTME: sanitization, falling back to a merged live TMDB search when local hits are thin.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { searchMovies, searchResultsToSummaries, type SearchSummary } from "@/lib/tmdb";

const LOCAL_LIMIT = 10;
const MIN_QUERY_CHARS = 2;
const TMDB_FALLBACK_THRESHOLD = 3;

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  // Strip SQL LIKE wildcards BEFORE the length check so "%%"-style queries
  // can't dump the catalog through the wildcard-only path.
  const rawQuery = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const query = rawQuery.replace(/[%_]/g, "");
  if (query.length < MIN_QUERY_CHARS) {
    return withAuthHeaders(NextResponse.json({ results: [] }), headers);
  }

  try {
    const { results: localRows } = await db
      .prepare(
        `SELECT tmdb_id, title, year, poster_path FROM titles
         WHERE content_type = 'movie' AND title LIKE '%' || ? || '%' COLLATE NOCASE
         ORDER BY popularity DESC LIMIT ?`
      )
      .bind(query, LOCAL_LIMIT)
      .all<{ tmdb_id: number; title: string; year: number | null; poster_path: string | null }>();

    const results: SearchSummary[] = localRows.map((row) => ({
      tmdbId: row.tmdb_id,
      title: row.title,
      year: row.year,
      posterPath: row.poster_path,
    }));

    if (results.length < TMDB_FALLBACK_THRESHOLD) {
      try {
        const tmdbResults = searchResultsToSummaries(await searchMovies(query, env.TMDB_API_TOKEN));
        const seen = new Set(results.map((r) => r.tmdbId));
        for (const summary of tmdbResults) {
          if (results.length >= LOCAL_LIMIT) break;
          if (seen.has(summary.tmdbId)) continue;
          seen.add(summary.tmdbId);
          results.push(summary);
        }
      } catch (err) {
        // A live-search outage shouldn't break local search; log and continue.
        console.error("GET /api/titles/search TMDB fallback:", err);
      }
    }

    return withAuthHeaders(NextResponse.json({ results }), headers);
  } catch (err) {
    console.error("GET /api/titles/search:", err);
    return withAuthHeaders(NextResponse.json({ error: "Search failed" }, { status: 500 }), headers);
  }
}
