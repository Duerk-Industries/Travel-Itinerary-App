--
-- Per-user watermark for chat read-state. One row per (user_id, trip_id)
-- capturing the `created_at` of the most-recently-read message.
--
-- This table was originally created inline in `db.postgres.ts` during the
-- Priority 9 watermark dual-write pass. Moved into a migration file as the
-- first proof-of-pattern for the Priority 10 "inline → migrations" cutover.
-- The migration runner auto-applies it on boot (see db.postgres.ts initDb);
-- the drift guard's EXPECTED_INLINE_TABLES has been trimmed to reflect that
-- the table no longer lives inline.
--
-- NOTE: migration files are Up-only. The runner executes the entire file as
-- a single multi-statement pg query, so any rollback DDL placed below the
-- CREATE blocks would immediately destroy the table on first apply. Rollback
-- lives in a separate .rollback.sql companion when needed.
CREATE TABLE IF NOT EXISTS chat_read_watermarks (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  last_read_message_id UUID NOT NULL,
  last_read_created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_watermarks_trip
  ON chat_read_watermarks(trip_id);
