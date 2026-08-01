-- Recommendation index tuning from the 2026-08-01 performance audit (§3.1-§3.4).
-- IF [NOT] EXISTS on every statement so a re-applied migration is a no-op, not an error.
--
-- The two DROPs are irreversible. To roll back:
--   CREATE INDEX idx_recommendations_session ON recommendations(session_id);
--   CREATE INDEX idx_movie_sessions_group ON movie_sessions(group_id);

-- countMatchesThisMonth runs on every match request and was the only unindexed
-- predicate on a hot path: SCAN -> SEARCH ... USING COVERING INDEX.
-- Measured at 50,049 rows: 38.0 ms -> 0.180 ms.
CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations(created_at);

-- Strictly widens idx_recommendations_session: session_id stays the leading
-- column, so getRoundNumber remains covering, and the latest-round lookup on the
-- results page no longer builds a temp b-tree for its ORDER BY.
DROP INDEX IF EXISTS idx_recommendations_session;
CREATE INDEX IF NOT EXISTS idx_recommendations_session_round ON recommendations(session_id, round_number DESC);

-- movie_sessions is never selected by group_id, and no code path deletes a groups
-- row, so this index serves no read and no cascade — it only costs write
-- amplification on every session insert. Anyone adding a DELETE FROM groups must
-- restore it (rollback SQL above): the ON DELETE CASCADE from groups would
-- otherwise full-scan movie_sessions.
DROP INDEX IF EXISTS idx_movie_sessions_group;
