// ABOUTME: D1 row interfaces mirroring the Phase 1 tables in migrations/0001_initial_schema.sql.
// ABOUTME: JSON-shaped TEXT columns stay typed as string here; parse with parseJsonColumn at the call site.

export interface UserRow {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AuthSessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  comfort_titles: string;
  watchlist: string;
  vibes: string;
  dealbreakers: string;
  streaming_services: string;
  updated_at: string;
}

export interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  joined_at: string;
}

export interface MovieSessionRow {
  id: string;
  group_id: string;
  initiated_by_user_id: string;
  mood_vibes: string;
  mood_text: string;
  discover_new: number;
  is_quick_match: number;
  created_at: string;
}

export interface SessionMemberRow {
  id: string;
  session_id: string;
  user_id: string;
  rough_day: number;
}

export interface RecommendationRow {
  id: string;
  session_id: string;
  round_number: number;
  ai_response: string;
  kept_tmdb_ids: string;
  removed_tmdb_ids: string;
  steering_feedback: string;
  model: string;
  prompt_version: string;
  candidate_snapshot: string;
  created_at: string;
}

export interface TitleRow {
  tmdb_id: number;
  content_type: string;
  title: string;
  year: number | null;
  genres: string;
  synopsis: string;
  poster_path: string | null;
  vote_count: number;
  vote_average: number;
  popularity: number;
  top_cast: string;
  keywords: string;
  streaming: string;
  seasons: number | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface RateLimitRow {
  id: number;
  scope: string;
  key: string;
  at: string;
}
