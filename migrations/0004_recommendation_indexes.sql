-- Recommendation index tuning.
-- IF [NOT] EXISTS on every statement so a re-applied migration is a no-op, not an error.
--
-- The two DROPs are irreversible. To roll back:
--   CREATE INDEX idx_recommendations_session ON recommendations(session_id);
--   CREATE INDEX idx_movie_sessions_group ON movie_sessions(group_id);

-- countMatchesThisMonth runs on every match request and is the only unindexed
-- predicate on a hot path: SCAN -> SEARCH ... USING COVERING INDEX.
-- dev/reports/2026-08-01-performance-audit.md §3.2 measured 38.0 ms -> 0.180 ms
-- at 50,049 rows, for a 1.6 MB index.
CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations(created_at);

-- Strictly widens idx_recommendations_session: session_id stays the leading
-- column, so getRoundNumber remains covering, and the latest-round lookup on the
-- results page no longer builds a temp b-tree for its ORDER BY. The replacement
-- is created before the index it supersedes is dropped, so no ordering question
-- arises.
CREATE INDEX IF NOT EXISTS idx_recommendations_session_round ON recommendations(session_id, round_number DESC);
DROP INDEX IF EXISTS idx_recommendations_session;

-- movie_sessions is never selected by group_id, and no code path deletes a groups
-- row, so this index serves no read and no cascade — it only costs write
-- amplification on every session insert. Anyone adding a DELETE FROM groups must
-- restore it (rollback SQL above): the ON DELETE CASCADE from groups would
-- otherwise full-scan movie_sessions.
--
-- Authority for this drop is dev/plans/2026-08-01-phase1-bug-hunt-remediation-plan.md
-- §8a G7-5 with dev/research/2026-08-01-remediation-decisions.md, NOT the
-- performance audit: audit §3.1 recommends keeping the index, on the expectation
-- that a groups delete would come to need the cascade. That expectation was
-- retired — deleting a group would cascade away an ex-member's history, so the
-- decision was to fix the copy instead and never delete the row.
DROP INDEX IF EXISTS idx_movie_sessions_group;
