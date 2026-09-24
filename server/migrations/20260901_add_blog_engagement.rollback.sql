-- Manual rollback for 20260901_add_blog_engagement.sql. Not run automatically; operational
-- runbook only. Drop order respects FK dependencies (children before parents).
DROP TABLE IF EXISTS scheduled_job_leases;
DROP TABLE IF EXISTS blog_comment_reports;
DROP TABLE IF EXISTS blog_comment_mentions;
DROP TABLE IF EXISTS blog_engagement_counters;
DROP TABLE IF EXISTS blog_comments;
DROP TABLE IF EXISTS blog_reactions;
