-- Manual rollback for 20260901_add_blog_comment_idempotency.sql. Not run automatically;
-- operational runbook only.
DROP INDEX IF EXISTS uq_blog_comments_author_idempotency;
ALTER TABLE blog_comments DROP COLUMN IF EXISTS idempotency_key;
