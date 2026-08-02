// ABOUTME: GET/PUT /api/user/profile — the signed-in user's taste profile with empty
// ABOUTME: defaults, validation limits, and TMDB enrichment of unknown tmdb ids.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import { chunk, D1_IN_CHUNK_SIZE, parseJsonColumn } from "@/lib/db";
import { RATE_LIMITS, withinRateLimit, recordRateLimitHit } from "@/lib/rate-limit";
import { fetchMovieDetail, detailToTitle, detailToEnrichment, TmdbError } from "@/lib/tmdb";
import type { ProfileRow } from "@/types/db";
import type { SkippedTitle } from "@/types/profile";

const MAX_TITLE_LIST_ENTRIES = 50;
const MAX_TAG_LIST_ENTRIES = 30;
const MAX_TAG_CHARS = 30;
// Every referenced id absent from `titles` costs one TMDB detail fetch and one D1
// write, taken sequentially inside the save the ritual's "Continue" blocks on. The
// two title lists already bound the referenced set at 2 × MAX_TITLE_LIST_ENTRIES;
// this holds the enrichment half of that to one list's worth.
const MAX_UNKNOWN_IDS_PER_PUT = MAX_TITLE_LIST_ENTRIES;

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
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("body must be a JSON object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return withAuthHeaders(NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }), headers);
  }

  const validationError = validateProfileBody(body);
  if (validationError) {
    return withAuthHeaders(NextResponse.json({ error: validationError }, { status: 400 }), headers);
  }
  const profile = body as unknown as ProfileBody;

  try {
    // MAX_UNKNOWN_IDS_PER_PUT bounds one save's TMDB fan-out; nothing bounded
    // how many saves. Checked after validation so a request we reject for free
    // never spends a slot, and before the enrichment loop so a refused save
    // costs one indexed count instead of 50 sequential fetches.
    if (!(await withinRateLimit(db, RATE_LIMITS.profileSave, user.userId))) {
      return withAuthHeaders(
        NextResponse.json(
          { error: "You're saving faster than we can keep up — give it a minute" },
          { status: 429 }
        ),
        headers
      );
    }
    await recordRateLimitHit(db, RATE_LIMITS.profileSave, user.userId);

    // Enrich any referenced tmdb id we don't have yet, so candidates and
    // posters always resolve from D1.
    const referenced = [...new Set([...profile.comfortTitles, ...profile.watchlist])];
    const known = new Set<number>();
    for (const ids of chunk(referenced, D1_IN_CHUNK_SIZE)) {
      const placeholders = ids.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT tmdb_id FROM titles WHERE content_type = 'movie' AND tmdb_id IN (${placeholders})`
        )
        .bind(...ids)
        .all<{ tmdb_id: number }>();
      for (const row of results) known.add(row.tmdb_id);
    }
    // Filtered against `referenced`, not built from query results: the unknownIds
    // and skippedTitles response bodies are order-visible to the client.
    const unknownIds = referenced.filter((id) => !known.has(id));

    if (unknownIds.length > MAX_UNKNOWN_IDS_PER_PUT) {
      return withAuthHeaders(
        NextResponse.json(
          {
            error: `A save can add at most ${MAX_UNKNOWN_IDS_PER_PUT} titles that aren't in our catalog yet — save some, then add the rest`,
            unknownIds,
          },
          { status: 400 }
        ),
        headers
      );
    }

    const skippedTitles: SkippedTitle[] = [];
    for (const id of unknownIds) {
      try {
        const detail = await fetchMovieDetail(id, env.TMDB_API_TOKEN);
        const title = detailToTitle(detail, {});
        const enrichment = detailToEnrichment(detail);
        const now = new Date().toISOString();
        await db
          .prepare(
            // last_refresh_attempt_at repeats last_refreshed_at: the TMDB fetch above
            // is an attempt and a success both, and the weekly refresh selects
            // candidates on the attempt stamp, so a NULL would put a title fetched
            // seconds ago straight back in the queue.
            `INSERT OR REPLACE INTO titles (tmdb_id, content_type, title, year, genres, synopsis, poster_path,
               vote_count, vote_average, popularity, top_cast, keywords, streaming, seasons, last_refreshed_at,
               last_refresh_attempt_at, created_at)
             VALUES (?, 'movie', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
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
            now,
            now
          )
          .run();
      } catch (err) {
        const gone = err instanceof TmdbError && err.status === 404;
        skippedTitles.push({ tmdbId: id, reason: gone ? "not-found" : "unavailable" });
      }
    }

    // A title we couldn't enrich is dropped rather than refusing the save: the
    // rest of the edit — the titles that resolved, and every tag, which has
    // nothing to do with TMDB — is not the bad id's to lose. The dropped ids
    // come back in the response so the outcome is never silent. They must not
    // reach `profiles` either, or the saved list would reference a tmdb id with
    // no `titles` row, which is what enrichment exists to prevent.
    const skippedIds = new Set(skippedTitles.map((skipped) => skipped.tmdbId));
    const saved: ProfileBody =
      skippedIds.size === 0
        ? profile
        : {
            ...profile,
            comfortTitles: profile.comfortTitles.filter((id) => !skippedIds.has(id)),
            watchlist: profile.watchlist.filter((id) => !skippedIds.has(id)),
          };

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
        JSON.stringify(saved.comfortTitles),
        JSON.stringify(saved.watchlist),
        JSON.stringify(saved.vibes),
        JSON.stringify(saved.dealbreakers),
        JSON.stringify(saved.streamingServices),
        new Date().toISOString()
      )
      .run();

    return withAuthHeaders(
      NextResponse.json(
        skippedTitles.length === 0 ? { profile: saved } : { profile: saved, skippedTitles }
      ),
      headers
    );
  } catch (err) {
    console.error("PUT /api/user/profile:", err);
    return withAuthHeaders(NextResponse.json({ error: "Failed to save profile" }, { status: 500 }), headers);
  }
}
