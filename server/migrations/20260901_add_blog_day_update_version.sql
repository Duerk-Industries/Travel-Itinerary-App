-- Phase 1 of docs/trip-blog-social-implementation-plan.md: optimistic concurrency for
-- blog_days.headline/summary edits (architecture §4.05, FR-A3.3). Every PATCH to a day's
-- headline/summary must include the current update_version; the server rejects a stale write
-- with 409 VERSION_CONFLICT rather than silently overwriting a concurrent editor, matching the
-- existing blog_items.version contract used for text-item edits.
ALTER TABLE blog_days ADD COLUMN IF NOT EXISTS update_version INTEGER NOT NULL DEFAULT 1;
