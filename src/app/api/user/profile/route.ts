// ABOUTME: GET/PUT /api/user/profile — the signed-in user's taste profile with empty
// ABOUTME: defaults, validation limits, and TMDB enrichment of unknown tmdb ids.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { parseJsonColumn } from "@/lib/db";
import { fetchMovieDetail, detailToTitle, detailToEnrichment } from "@/lib/tmdb";
import type { ProfileRow } from "@/types/db";

const MAX_TITLE_LIST_ENTRIES = 50;
const MAX_TAG_LIST_ENTRIES = 30;
const MAX_TAG_CHARS = 30;
const MAX_UNKNOWN_IDS_PER_PUT = 10;

interface ProfileBody {
  comfortTitles: number[];
  watchlist: number[];
  vibes: string[];
  dealbreakers: string[];
  streamingServices: string[];
}

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

function emptyProfile(): ProfileBody {
  return { comfortTitles: [], watchlist: [], vibes: [], dealbreakers: [], streamingServices: [] };
}

function validateIdList(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array`;
  if (value.length > MAX_TITLE_LIST_ENTRIES) return `${field} can hold at most ${MAX_TITLE_LIST_ENTRIES} titles`;
  if (!value.every((id) => Number.isInteger(id))) return `${field} must contain integer tmdb ids`;
  return null;
}

function validateTagList(value: unknown, field: string): string | null {
  if (!Array.isArray(value)) return `${field} must be an array`;
  if (value.length > MAX_TAG_LIST_ENTRIES) return `${field} can hold at most ${MAX_TAG_LIST_ENTRIES} entries`;
  if (!value.every((tag) => typeof tag === "string" && tag.length <= MAX_TAG_CHARS)) {
    return `${field} entries must be strings of at most ${MAX_TAG_CHARS} characters`;
  }
  return null;
}

function validateProfileBody(body: Record<string, unknown>): string | null {
  return (
    validateIdList(body.comfortTitles, "comfortTitles") ??
    validateIdList(body.watchlist, "watchlist") ??
    validateTagList(body.vibes, "vibes") ??
    validateTagList(body.dealbreakers, "dealbreakers") ??
    validateTagList(body.streamingServices, "streamingServices")
  );
}

export async function GET(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const row = await db
      .prepare("SELECT * FROM profiles WHERE user_id = ?")
      .bind(user.userId)
      .first<ProfileRow>();

    const profile: ProfileBody = row
      ? {
          comfortTitles: parseJsonColumn<number[]>(row.comfort_titles, []),
          watchlist: parseJsonColumn<number[]>(row.watchlist, []),
          vibes: parseJsonColumn<string[]>(row.vibes, []),
          dealbreakers: parseJsonColumn<string[]>(row.dealbreakers, []),
          streamingServices: parseJsonColumn<string[]>(row.streaming_services, []),
        }
      : emptyProfile();

    return withAuthHeaders(NextResponse.json({ profile }), headers);
  } catch (err) {
    console.error("GET /api/user/profile:", err);
    return withAuthHeaders(NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 }), headers);
  }
}

export async function PUT(request: NextRequest) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withAuthHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }), headers);
  }

  const validationError = validateProfileBody(body);
  if (validationError) {
    return withAuthHeaders(NextResponse.json({ error: validationError }, { status: 400 }), headers);
  }
  const profile = body as unknown as ProfileBody;

  try {
    // Enrich any referenced tmdb id we don't have yet, so candidates and
    // posters always resolve from D1.
    const referenced = [...new Set([...profile.comfortTitles, ...profile.watchlist])];
    const unknownIds: number[] = [];
    for (const id of referenced) {
      const existing = await db
        .prepare("SELECT 1 FROM titles WHERE tmdb_id = ? AND content_type = 'movie'")
        .bind(id)
        .first();
      if (!existing) unknownIds.push(id);
    }

    if (unknownIds.length > MAX_UNKNOWN_IDS_PER_PUT) {
      return withAuthHeaders(
        NextResponse.json(
          { error: `More than ${MAX_UNKNOWN_IDS_PER_PUT} unknown titles in one save`, unknownIds },
          { status: 400 }
        ),
        headers
      );
    }

    const failedIds: number[] = [];
    for (const id of unknownIds) {
      try {
        const detail = await fetchMovieDetail(id, env.TMDB_API_TOKEN);
        const title = detailToTitle(detail, {});
        const enrichment = detailToEnrichment(detail);
        const now = new Date().toISOString();
        await db
          .prepare(
            `INSERT OR REPLACE INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path,
               vote_count, vote_average, popularity, top_cast, keywords, streaming, seasons, last_refreshed_at, created_at)
             VALUES (?, 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
          )
          .bind(
            title.tmdbId,
            title.title,
            title.year,
            JSON.stringify(title.genres),
            title.synopsis,
            title.posterPath,
            title.voteCount,
            title.voteAverage,
            title.popularity,
            JSON.stringify(enrichment.topCast),
            JSON.stringify(enrichment.keywords),
            JSON.stringify(enrichment.streaming),
            now,
            now
          )
          .run();
      } catch {
        failedIds.push(id);
      }
    }
    if (failedIds.length > 0) {
      return withAuthHeaders(
        NextResponse.json({ error: "Some titles could not be fetched from TMDB", failedIds }, { status: 400 }),
        headers
      );
    }

    await db
      .prepare(
        `INSERT INTO profiles (user_id, comfort_titles, watchlist, vibes, dealbreakers, streaming_services, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           comfort_titles = excluded.comfort_titles,
           watchlist = excluded.watchlist,
           vibes = excluded.vibes,
           dealbreakers = excluded.dealbreakers,
           streaming_services = excluded.streaming_services,
           updated_at = excluded.updated_at`
      )
      .bind(
        user.userId,
        JSON.stringify(profile.comfortTitles),
        JSON.stringify(profile.watchlist),
        JSON.stringify(profile.vibes),
        JSON.stringify(profile.dealbreakers),
        JSON.stringify(profile.streamingServices),
        new Date().toISOString()
      )
      .run();

    return withAuthHeaders(NextResponse.json({ profile }), headers);
  } catch (err) {
    console.error("PUT /api/user/profile:", err);
    return withAuthHeaders(NextResponse.json({ error: "Failed to save profile" }, { status: 500 }), headers);
  }
}
