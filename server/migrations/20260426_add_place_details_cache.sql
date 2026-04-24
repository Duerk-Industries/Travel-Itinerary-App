--
-- Result cache for Google Places "details" lookups keyed by place_id. The
-- service layer in placeService.ts reads here before calling the remote API
-- and writes the fresh payload back. Zero foreign keys — the cache is
-- standalone and can be truncated without affecting trip data.
--
-- Cut over from inline `CREATE TABLE IF NOT EXISTS` in db.postgres.ts to
-- this migration file under the Priority 10 "inline → migrations" program.
-- Rollback lives in the `.rollback.sql` companion.
CREATE TABLE IF NOT EXISTS place_details_cache (
  place_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
