// ABOUTME: Client-side data access shared by the ritual and quick-match flows —
// ABOUTME: profile load/save, quick picks, group members, session create and match.
import type { ProfileDraft } from "@/components/profile-editor";
import type { TitleRef } from "@/components/title-search";
import type { SessionView, TitleSummary } from "@/lib/movie-sessions";
import type { MatchingResponse } from "@/types/matching";

export interface Member {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

const GENERIC_ERROR = "Something went wrong. Check your connection and try again.";

interface SavedProfile {
  comfortTitles: number[];
  watchlist: number[];
  vibes: string[];
  dealbreakers: string[];
  streamingServices: string[];
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * POSTs/PUTs and returns the server's user-facing error string, or null on
 * success. `kind` carries the matching error taxonomy through untouched so the
 * results page can branch on it; every other caller ignores it.
 */
async function send<T>(
  url: string,
  method: "POST" | "PUT",
  body: unknown
): Promise<{ data: T | null; error: string | null; kind: string | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as
      | (T & { error?: string; kind?: string })
      | null;
    if (!res.ok) {
      return { data: null, error: parsed?.error ?? GENERIC_ERROR, kind: parsed?.kind ?? null };
    }
    return { data: parsed as T, error: null, kind: null };
  } catch {
    return { data: null, error: GENERIC_ERROR, kind: null };
  }
}

/**
 * Loads the saved profile and resolves its tmdb ids back to titles, preserving
 * the saved order. Returns null when either half fails — the caller must not
 * render an empty editor over a failed load, or a save would erase the profile.
 */
export async function fetchProfileDraft(): Promise<ProfileDraft | null> {
  const body = await getJson<{ profile: SavedProfile }>("/api/user/profile");
  if (body === null) return null;

  const { profile } = body;
  const ids = [...new Set([...profile.comfortTitles, ...profile.watchlist])];
  let byId = new Map<number, TitleRef>();
  if (ids.length > 0) {
    const resolved = await getJson<{ results: TitleRef[] }>(
      `/api/titles/search?ids=${ids.join(",")}`
    );
    if (resolved === null) return null;
    byId = new Map(resolved.results.map((title) => [title.tmdbId, title]));
  }

  const pick = (list: number[]): TitleRef[] =>
    list.map((id) => byId.get(id)).filter((title) => title !== undefined);

  return {
    comfortTitles: pick(profile.comfortTitles),
    watchlist: pick(profile.watchlist),
    vibes: profile.vibes,
    dealbreakers: profile.dealbreakers,
    streamingServices: profile.streamingServices,
  };
}

/** Tap-to-add suggestions for an empty comfort list. Failure is not worth blocking on. */
export async function fetchQuickPicks(): Promise<TitleRef[]> {
  const body = await getJson<{ results: TitleRef[] }>("/api/titles/search?popular=1");
  return body?.results ?? [];
}

export interface GroupSummary {
  name: string;
  members: Member[];
}

export async function fetchGroup(groupId: string): Promise<GroupSummary | null> {
  const body = await getJson<{ group: GroupSummary }>(
    `/api/groups/${encodeURIComponent(groupId)}`
  );
  if (body === null) return null;
  return { name: body.group.name, members: body.group.members };
}

export async function saveProfile(draft: ProfileDraft): Promise<string | null> {
  const { error } = await send("/api/user/profile", "PUT", {
    comfortTitles: draft.comfortTitles.map((t) => t.tmdbId),
    watchlist: draft.watchlist.map((t) => t.tmdbId),
    vibes: draft.vibes,
    dealbreakers: draft.dealbreakers,
    streamingServices: draft.streamingServices,
  });
  return error;
}

export interface StartSessionArgs {
  groupId: string | null;
  moodVibes: string[];
  moodText: string;
  discoverNew: boolean;
  isQuickMatch: boolean;
  roughDay: boolean;
  /** Other members' own flags, keyed by user id. Only the set ones are sent. */
  memberFlags: Record<string, boolean>;
}

export async function startSession(
  args: StartSessionArgs
): Promise<{ sessionId: string | null; error: string | null }> {
  const flags: Record<string, { roughDay: boolean }> = {};
  for (const [userId, roughDay] of Object.entries(args.memberFlags)) {
    if (roughDay) flags[userId] = { roughDay: true };
  }

  const { data, error } = await send<{ sessionId: string }>(
    "/api/movie-sessions",
    "POST",
    {
      groupId: args.groupId,
      moodVibes: args.moodVibes,
      moodText: args.moodText,
      discoverNew: args.discoverNew,
      isQuickMatch: args.isQuickMatch,
      roughDay: args.roughDay,
      ...(Object.keys(flags).length > 0 ? { memberFlags: flags } : {}),
    }
  );
  const sessionId = data?.sessionId ?? null;
  // A 200 with no sessionId is still a failure the caller has to render.
  return { sessionId, error: sessionId === null ? (error ?? GENERIC_ERROR) : null };
}

/** Runs a matching round. Returns the server's user-facing error, or null on success. */
export async function requestMatch(sessionId: string): Promise<string | null> {
  const { error } = await send(
    `/api/movie-sessions/${encodeURIComponent(sessionId)}/match`,
    "POST",
    {}
  );
  return error;
}

/** One matching round's payload, from either the session GET or a match POST. */
export interface MatchRound {
  round: number;
  response: MatchingResponse;
  titles: Record<number, TitleSummary>;
}

export interface SessionResults {
  session: SessionView;
  /** 0 when the session exists but has never been matched. */
  round: number;
  response: MatchingResponse | null;
  titles: Record<number, TitleSummary>;
}

/** Reloads a session's latest round. Null means "we cannot show this tonight". */
export async function fetchSessionResults(sessionId: string): Promise<SessionResults | null> {
  return getJson<SessionResults>(`/api/movie-sessions/${encodeURIComponent(sessionId)}`);
}

export interface RefinementInput {
  keptTmdbIds: number[];
  removedTmdbIds: number[];
  steeringFeedback: string;
}

/**
 * Runs a refinement round. Unlike `requestMatch` this surfaces the payload and
 * the error `kind`, because the results page has to render both.
 */
export async function runMatchRound(
  sessionId: string,
  input: RefinementInput
): Promise<{ data: MatchRound | null; error: string | null; kind: string | null }> {
  return send<MatchRound>(
    `/api/movie-sessions/${encodeURIComponent(sessionId)}/match`,
    "POST",
    input
  );
}
