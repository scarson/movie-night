// ABOUTME: Client-side data access shared by the ritual and quick-match flows —
// ABOUTME: profile load/save, quick picks, group members, session create and match.
import type { ProfileDraft } from "@/components/profile-editor";
import type { TitleRef } from "@/components/title-search";
import type { SessionView, TitleSummary } from "@/lib/movie-sessions";
import type { MatchingResponse } from "@/types/matching";
import type { SkippedTitle } from "@/types/profile";

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

/** How many titles a skipped-title notice names before it counts the rest. */
const SKIPPED_NAMES_SHOWN = 3;

function nameList(names: string[]): string {
  const shown = names.slice(0, SKIPPED_NAMES_SHOWN);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * Phrases what a save could not add, or null when the whole edit landed. The
 * two reasons need different remedies — a title TMDB has dropped will never
 * save, one it couldn't answer for probably will — so they get a clause each.
 */
function skippedNotice(skipped: SkippedTitle[], draft: ProfileDraft): string | null {
  if (skipped.length === 0) return null;

  const byId = new Map(
    [...draft.comfortTitles, ...draft.watchlist].map((title) => [title.tmdbId, title.title])
  );
  const named = (reason: SkippedTitle["reason"]) =>
    skipped
      .filter((title) => title.reason === reason)
      .map((title) => byId.get(title.tmdbId) ?? `#${title.tmdbId}`);

  const gone = named("not-found");
  const unreachable = named("unavailable");
  const clauses: string[] = [];
  if (gone.length > 0) {
    clauses.push(
      gone.length === 1
        ? `${nameList(gone)} isn't in TMDB anymore, so it wasn't added — pick something else instead.`
        : `${nameList(gone)} aren't in TMDB anymore, so they weren't added — pick something else instead.`
    );
  }
  if (unreachable.length > 0) {
    clauses.push(
      unreachable.length === 1
        ? `We couldn't reach TMDB for ${nameList(unreachable)}, so it wasn't added — try again in a little while.`
        : `We couldn't reach TMDB for ${nameList(unreachable)}, so they weren't added — try again in a little while.`
    );
  }
  return `Saved. ${clauses.join(" ")}`;
}

export interface ProfileSaveResult {
  /** The server's user-facing error, or null when the save landed. */
  error: string | null;
  /**
   * Titles the save could not add, already phrased. A save can land and still
   * carry one of these, so it is not an alternative to `error`.
   */
  notice: string | null;
}

export async function saveProfile(draft: ProfileDraft): Promise<ProfileSaveResult> {
  const { data, error } = await send<{ skippedTitles?: SkippedTitle[] }>(
    "/api/user/profile",
    "PUT",
    {
      comfortTitles: draft.comfortTitles.map((t) => t.tmdbId),
      watchlist: draft.watchlist.map((t) => t.tmdbId),
      vibes: draft.vibes,
      dealbreakers: draft.dealbreakers,
      streamingServices: draft.streamingServices,
    }
  );
  if (error !== null) return { error, notice: null };
  return { error: null, notice: skippedNotice(data?.skippedTitles ?? [], draft) };
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

/**
 * Runs a matching round. Returns the server's user-facing error and its `kind`,
 * or `{ error: null }` on success. The kind decides which of the failure's ways
 * out can actually work, so the caller has to see it.
 */
export async function requestMatch(
  sessionId: string
): Promise<{ error: string | null; kind: string | null }> {
  const { error, kind } = await send(
    `/api/movie-sessions/${encodeURIComponent(sessionId)}/match`,
    "POST",
    {}
  );
  return { error, kind };
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

/**
 * Reloads a session's latest round.
 *
 * `"missing"` is only the member-scoped GET's 404, which is deliberately the
 * same for an unknown session and a session the caller isn't a member of — the
 * two must stay indistinguishable, so callers can assert neither over the other.
 * `"error"` is a transient failure (network throw, 5xx, unparseable body) and
 * says nothing about whether the session exists.
 */
export type SessionLoad =
  | { status: "ok"; results: SessionResults }
  | { status: "missing" }
  | { status: "error" };

export async function fetchSessionResults(sessionId: string): Promise<SessionLoad> {
  try {
    const res = await fetch(`/api/movie-sessions/${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as SessionResults | null;
      return data === null ? { status: "error" } : { status: "ok", results: data };
    }
    return res.status === 404 ? { status: "missing" } : { status: "error" };
  } catch {
    return { status: "error" };
  }
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
