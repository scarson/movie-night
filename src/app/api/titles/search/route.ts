// ABOUTME: GET /api/titles/search — catalog reads for the pickers: ?ids= resolves saved
// ABOUTME: tmdb ids, ?popular= lists quick picks, ?q= searches locally then merges TMDB.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { searchMovies, searchResultsToSummaries, type SearchSummary } from "@/lib/tmdb";

const LOCAL_LIMIT = 10;
const MIN_QUERY_CHARS = 2;
const TMDB_FALLBACK_THRESHOLD = 3;
/** Covers a full profile in one call: comfort titles (≤50) plus watchlist (≤50). */
const MAX_RESOLVED_IDS = 100;
const QUICK_PICK_LIMIT = 12;

interface TitleRow {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
}

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

function rowToSummary(row: TitleRow): SearchSummary {
  return { tmdbId: row.tmdb_id, title: row.title, year: row.year, posterPath: row.poster_path };
}

/** Parses `?ids=1,2,3` into deduped integers, capped so the IN-list stays bounded. */
function parseIds(raw: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const id = Number(trimmed);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_RESOLVED_IDS) break;
  }
  return ids;
}

/**
 * Resolves saved tmdb ids to catalog entries, preserving the caller's order —
 * a profile's title lists are user-ordered, not popularity-ordered. Local only:
 * the profile PUT enriches unknown ids at save time, so every saved id is here.
 */
async function resolveIds(db: D1Database, ids: number[]): Promise<SearchSummary[]> {
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT tmdb_id, title, year, poster_path FROM titles
       WHERE content_type = 'movie' AND tmdb_id IN (${placeholders})`
    )
    .bind(...ids)
    .all<TitleRow>();

  const byId = new Map(results.map((row) => [row.tmdb_id, rowToSummary(row)]));
  return ids.map((id) => byId.get(id)).filter((summary) => summary !== undefined);
}

/** The tap-to-add quick picks shown above an empty title search. */
async function popularTitles(db: D1Database): Promise<SearchSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT tmdb_id, title, year, poster_path FROM titles
       WHERE content_type = 'movie' ORDER BY popularity DESC LIMIT ?`
    )
    .bind(QUICK_PICK_LIMIT)
    .all<TitleRow>();
  return results.map(rowToSummary);
}

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const params = request.nextUrl.searchParams;

  // Catalog reads come first: a saved-id resolution or a quick-pick list is a
  // complete answer on its own, so a stray `q` can never widen either one.
  const rawIds = params.get("ids");
  if (rawIds !== null) {
    const ids = parseIds(rawIds);
    try {
      const results = ids.length === 0 ? [] : await resolveIds(db, ids);
      return withAuthHeaders(NextResponse.json({ results }), headers);
    } catch (err) {
      console.error("GET /api/titles/search ids:", err);
      return withAuthHeaders(NextResponse.json({ error: "Lookup failed" }, { status: 500 }), headers);
    }
  }

  if (params.get("popular") !== null) {
    try {
      return withAuthHeaders(NextResponse.json({ results: await popularTitles(db) }), headers);
    } catch (err) {
      console.error("GET /api/titles/search popular:", err);
      return withAuthHeaders(NextResponse.json({ error: "Lookup failed" }, { status: 500 }), headers);
    }
  }

  // Strip SQL LIKE wildcards BEFORE the length check so "%%"-style queries
  // can't dump the catalog through the wildcard-only path.
  const rawQuery = (params.get("q") ?? "").trim();
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
