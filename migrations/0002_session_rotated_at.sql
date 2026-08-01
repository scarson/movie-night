-- Marks a refresh token as already rotated. The UPDATE that sets it is the
-- single-winner arbiter for concurrent rotation; the timestamp then bounds
-- how long the spent token still authenticates (without issuing cookies).
ALTER TABLE sessions ADD COLUMN rotated_at TEXT;
