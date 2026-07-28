-- Movie Night initial schema. Users/auth mirror twin-cities-tee-times;
-- groups are the unit of matching (couple = group of 2, solo = group of 1).
-- "titles" not "movies": content_type distinguishes movie vs tv.
-- Phase 2 tables (watch_history, watch_ratings, tension_axes) created empty now.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  comfort_titles TEXT NOT NULL DEFAULT '[]',      -- JSON array of tmdb_id ints
  watchlist TEXT NOT NULL DEFAULT '[]',           -- JSON array of tmdb_id ints
  vibes TEXT NOT NULL DEFAULT '[]',               -- JSON array of tag strings (presets + custom)
  dealbreakers TEXT NOT NULL DEFAULT '[]',        -- JSON array of tag strings
  streaming_services TEXT NOT NULL DEFAULT '[]',  -- JSON array of provider names
  updated_at TEXT NOT NULL
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  UNIQUE(group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE movie_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  initiated_by_user_id TEXT NOT NULL,
  mood_vibes TEXT NOT NULL DEFAULT '[]',
  mood_text TEXT NOT NULL DEFAULT '',
  discover_new INTEGER NOT NULL DEFAULT 0,
  is_quick_match INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_movie_sessions_group ON movie_sessions(group_id);

CREATE TABLE session_members (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES movie_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rough_day INTEGER NOT NULL DEFAULT 0,  -- 1 = THIS member toggled generosity: deprioritize THEIR OWN prefs, favor the others
  UNIQUE(session_id, user_id)
);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES movie_sessions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  ai_response TEXT NOT NULL,            -- full MatchingResponse JSON
  kept_tmdb_ids TEXT NOT NULL DEFAULT '[]',
  removed_tmdb_ids TEXT NOT NULL DEFAULT '[]',
  steering_feedback TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  candidate_snapshot TEXT NOT NULL,     -- JSON array of tmdb_ids sent as candidates
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recommendations_session ON recommendations(session_id);

CREATE TABLE titles (
  tmdb_id INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'movie',   -- 'movie' | 'tv'
  title TEXT NOT NULL,
  year INTEGER,
  genres TEXT NOT NULL DEFAULT '[]',            -- JSON array of genre name strings
  synopsis TEXT NOT NULL DEFAULT '',
  poster_path TEXT,                              -- TMDB path fragment, e.g. /abc.jpg
  vote_count INTEGER NOT NULL DEFAULT 0,
  vote_average REAL NOT NULL DEFAULT 0,
  popularity REAL NOT NULL DEFAULT 0,
  top_cast TEXT NOT NULL DEFAULT '[]',          -- JSON array of top-billed cast names ('cast' is a SQLite keyword)
  keywords TEXT NOT NULL DEFAULT '[]',          -- JSON array of keyword strings
  streaming TEXT NOT NULL DEFAULT '{}',         -- JSON: US watch/providers subset
  seasons INTEGER,                               -- NULL for movies
  last_refreshed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (tmdb_id, content_type)
);
CREATE INDEX idx_titles_popularity ON titles(popularity DESC);

CREATE TABLE rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,        -- e.g. 'group_join', 'match'
  key TEXT NOT NULL,          -- e.g. IP or user_id
  at TEXT NOT NULL
);
CREATE INDEX idx_rate_limit_scope_key ON rate_limit_log(scope, key, at);

-- Phase 2 tables (empty in Phase 1; avoids a migration later)
CREATE TABLE watch_history (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'movie',
  recommended_in_session_id TEXT,
  watched_at TEXT NOT NULL
);

CREATE TABLE watch_ratings (
  id TEXT PRIMARY KEY,
  watch_history_id TEXT NOT NULL REFERENCES watch_history(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER,
  surprise_feedback TEXT
);

CREATE TABLE tension_axes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  axis_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position_a TEXT NOT NULL DEFAULT '',
  position_b TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL,
  updated_at TEXT
);
