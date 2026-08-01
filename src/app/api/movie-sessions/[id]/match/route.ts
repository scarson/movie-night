// ABOUTME: POST /api/movie-sessions/[id]/match — runs a matching round: caps, profile
// ABOUTME: loading, candidate selection, the Claude call, persistence, and the titles map.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateRequest } from "@/lib/auth";
import {
  runMatching,
  selectCandidates,
  MatchingError,
  type MatchingErrorKind,
} from "@/lib/matching";
import {
  getSessionForMember,
  getSessionMembersWithProfiles,
  getRoundNumber,
  getAccumulatedRemovedIds,
  getRecommendedTmdbIds,
  countMatchesThisMonth,
  formatTitleRefs,
  getTitlesMap,
  insertRecommendation,
} from "@/lib/movie-sessions";

const MAX_ROUNDS_PER_SESSION = 10;
const DEFAULT_MONTHLY_MATCH_LIMIT = 2000;
const MAX_ID_LIST_ENTRIES = 50;
const MAX_STEERING_CHARS = 300;

/** Locked error-taxonomy → HTTP contract (the UI branches on `kind`). */
const MATCHING_ERROR_HTTP: Record<MatchingErrorKind, { status: number; error: string }> = {
  malformed: { status: 502, error: "Our movie brain got confused — try again" },
  thin_results: { status: 502, error: "That was a tough brief — try loosening a dealbreaker" },
  timeout: { status: 503, error: "Our movie brain is taking a nap — try again in a moment" },
  overloaded: { status: 503, error: "Our movie brain is taking a nap — try again in a moment" },
  rate_limited: { status: 429, error: "We're getting a lot of requests right now, try again in a moment" },
};

function withAuthHeaders(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.append(key, value));
  return response;
}

function validateBody(body: Record<string, unknown>): string | null {
  for (const field of ["keptTmdbIds", "removedTmdbIds"]) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (value.length > MAX_ID_LIST_ENTRIES) return `${field} can hold at most ${MAX_ID_LIST_ENTRIES} ids`;
    if (!value.every((id) => Number.isInteger(id))) return `${field} must contain integer tmdb ids`;
  }
  const steering = body.steeringFeedback;
  if (steering !== undefined && (typeof steering !== "string" || steering.length > MAX_STEERING_CHARS)) {
    return `steeringFeedback must be a string of at most ${MAX_STEERING_CHARS} characters`;
  }
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { env } = await getCloudflareContext();
  const db = env.DB;
  const { user, headers } = await authenticateRequest(request, db, env.JWT_SECRET);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const { id } = await params;

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
  const keptTmdbIds = (body.keptTmdbIds as number[] | undefined) ?? [];
  const removedTmdbIds = (body.removedTmdbIds as number[] | undefined) ?? [];
  const steeringFeedback = (body.steeringFeedback as string | undefined) ?? "";

  try {
    const session = await getSessionForMember(db, id, user.userId);
    if (!session) {
      return withAuthHeaders(NextResponse.json({ error: "Session not found" }, { status: 404 }), headers);
    }

    // Round limit. Plain SELECT-then-insert: the TOCTOU race is ACCEPTED per
    // eng review — blast radius is one extra ~$0.04 call; no locking.
    const round = await getRoundNumber(db, id);
    if (round > MAX_ROUNDS_PER_SESSION) {
      return withAuthHeaders(
        NextResponse.json(
          { error: "You've hit tonight's refinement limit", kind: "round_limit" },
          { status: 429 }
        ),
        headers
      );
    }

    const monthlyLimit = Number.parseInt(env.MONTHLY_MATCH_LIMIT ?? "", 10) || DEFAULT_MONTHLY_MATCH_LIMIT;
    if ((await countMatchesThisMonth(db)) >= monthlyLimit) {
      return withAuthHeaders(
        NextResponse.json(
          { error: "We're getting a lot of requests right now, try again later", kind: "monthly_cap" },
          { status: 429 }
        ),
        headers
      );
    }

    // A client may only keep or reject a film this session actually showed it.
    // Unrecognised ids are dropped rather than rejected: a stale second tab
    // holding an older round's ids must not hard-fail the app's costliest path.
    const recommendedIds = await getRecommendedTmdbIds(db, id);
    const acceptedKeptIds = keptTmdbIds.filter((tmdbId) => recommendedIds.has(tmdbId));
    const acceptedRemovedIds = removedTmdbIds.filter((tmdbId) => recommendedIds.has(tmdbId));
    if (acceptedRemovedIds.length !== removedTmdbIds.length) {
      console.log(
        JSON.stringify({
          event: "removed_ids_filtered",
          session_id: id,
          submitted: removedTmdbIds.length,
          accepted: acceptedRemovedIds.length,
        })
      );
    }

    const members = await getSessionMembersWithProfiles(db, id);
    const allRemovedIds = [
      ...new Set([...(await getAccumulatedRemovedIds(db, id)), ...acceptedRemovedIds]),
    ];

    const candidates = await selectCandidates(db, members, session.discoverNew, new Set(allRemovedIds));
    const titlesForNames = await getTitlesMap(
      db,
      [...new Set(members.flatMap((m) => [...m.comfortTitles, ...m.watchlist]))]
    );
    const nameList = (ids: number[]) =>
      ids.filter((tmdbId) => titlesForNames[tmdbId] !== undefined).map((tmdbId) => titlesForNames[tmdbId].title);

    const response = await runMatching({
      env,
      input: {
        members: members.map((m) => ({
          userId: m.userId,
          name: m.name,
          comfortTitles: nameList(m.comfortTitles),
          watchlist: nameList(m.watchlist),
          vibes: m.vibes,
          dealbreakers: m.dealbreakers,
          streamingServices: m.streamingServices,
          roughDay: m.roughDay,
        })),
        moodVibes: session.moodVibes,
        moodText: session.moodText,
        discoverNew: session.discoverNew,
        keptTitles: await formatTitleRefs(db, acceptedKeptIds),
        removedTitles: await formatTitleRefs(db, allRemovedIds),
        steeringFeedback,
        candidates,
        solo: session.solo,
      },
      context: { groupId: session.groupId, sessionId: id, round },
    });

    await insertRecommendation(db, {
      sessionId: id,
      roundNumber: round,
      aiResponse: response,
      keptTmdbIds: acceptedKeptIds,
      removedTmdbIds: acceptedRemovedIds,
      steeringFeedback,
      candidateSnapshot: candidates.map((c) => c.tmdbId),
    });

    const titles = await getTitlesMap(db, response.recommendations.map((rec) => rec.tmdbId));
    return withAuthHeaders(NextResponse.json({ round, response, titles }), headers);
  } catch (err) {
    if (err instanceof MatchingError) {
      const { status, error } = MATCHING_ERROR_HTTP[err.kind];
      return withAuthHeaders(NextResponse.json({ error, kind: err.kind }, { status }), headers);
    }
    console.error("POST /api/movie-sessions/[id]/match:", err);
    return withAuthHeaders(NextResponse.json({ error: "Match failed" }, { status: 500 }), headers);
  }
}
