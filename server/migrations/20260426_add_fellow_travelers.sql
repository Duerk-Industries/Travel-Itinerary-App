--
-- "Fellow travelers" are per-user address-book entries used as quick-pick
-- defaults when adding participants to a trip. The unique index makes
-- (owner_id, first_name, last_name) case-insensitively unique so the same
-- traveler doesn't duplicate across retries.
--
-- Cut over from inline `CREATE TABLE IF NOT EXISTS` in db.postgres.ts to
-- this migration file under the Priority 10 "inline → migrations" program.
-- The inline ALTER for `email` (added post-factum before the cutover) is
-- folded directly into the CREATE TABLE here so the column exists on first
-- apply. Rollback lives in the `.rollback.sql` companion.
CREATE TABLE IF NOT EXISTS fellow_travelers (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fellow_travelers_owner_name
  ON fellow_travelers(owner_id, LOWER(first_name), LOWER(last_name));
