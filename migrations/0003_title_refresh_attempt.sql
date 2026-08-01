-- Separates "we tried" from "we succeeded". last_refreshed_at is rendered to
-- users by asOfNote(); stamping it on a failed fetch would assert a freshness
-- that never happened. The staleness predicate keys off the attempt instead,
-- so a permanently-failing title stops holding a slot every single run.
ALTER TABLE titles ADD COLUMN last_refresh_attempt_at TEXT;
UPDATE titles SET last_refresh_attempt_at = last_refreshed_at;
