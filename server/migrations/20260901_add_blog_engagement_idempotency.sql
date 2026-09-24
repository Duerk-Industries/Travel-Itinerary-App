-- Phase 4 of docs/trip-blog-social-implementation-plan.md — comment creation requires an
-- Idempotency-Key header (architecture §5.1, matching the existing convention in
-- blogSocialRoutes.ts). Unlike that route, which only acknowledges the key, comment creation
-- actually enforces it: a retried POST (the same author replaying a dropped request) returns the
-- original comment rather than creating a duplicate.
ALTER TABLE blog_comments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_comments_author_idempotency
  ON blog_comments(author_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
