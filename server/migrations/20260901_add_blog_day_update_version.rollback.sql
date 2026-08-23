-- Manual rollback for 20260901_add_blog_day_update_version.sql. Not run
-- automatically; operational runbook only.
ALTER TABLE blog_days DROP COLUMN IF EXISTS update_version;
