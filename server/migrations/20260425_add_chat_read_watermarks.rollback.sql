-- Rollback companion for 20260425_add_chat_read_watermarks.sql.
-- Not run automatically — invoke manually via `psql` if a cutover needs to
-- be reverted. Kept for reference / operational runbook.
DROP INDEX IF EXISTS idx_chat_read_watermarks_trip;
DROP TABLE IF EXISTS chat_read_watermarks;
