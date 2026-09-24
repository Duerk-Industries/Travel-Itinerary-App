-- Manual rollback for 20260901_add_blog_authoring.sql. Not run automatically; operational
-- runbook only. Does not touch blog_days.update_version — that column belongs to
-- 20260901_add_blog_day_update_version.sql and its own rollback.
DROP TABLE IF EXISTS blog_recap_snapshots;
DROP TABLE IF EXISTS blog_comment_strikes;
ALTER TABLE blog_media_assets DROP COLUMN IF EXISTS is_decorative;
ALTER TABLE blog_media_assets DROP COLUMN IF EXISTS captured_lng;
ALTER TABLE blog_media_assets DROP COLUMN IF EXISTS captured_lat;
ALTER TABLE trip_blogs DROP COLUMN IF EXISTS engagement_revision;
ALTER TABLE trip_blogs DROP COLUMN IF EXISTS follower_comments_enabled;
ALTER TABLE trip_blogs DROP COLUMN IF EXISTS photo_location_enabled;
DROP TABLE IF EXISTS blog_day_starter_dismissals;
