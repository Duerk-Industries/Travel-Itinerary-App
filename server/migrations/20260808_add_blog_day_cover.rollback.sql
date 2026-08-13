-- Manual rollback for 20260808_add_blog_day_cover.sql. Not run
-- automatically; operational runbook only.
ALTER TABLE blog_days DROP COLUMN IF EXISTS cover_set_at;
ALTER TABLE blog_days DROP COLUMN IF EXISTS cover_set_by_user_id;
ALTER TABLE blog_days DROP COLUMN IF EXISTS cover_asset_id;
