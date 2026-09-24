-- Phase 6b of docs/trip-blog-social-implementation-plan.md — collaborative stars (B15).
-- See docs/trip-blog-social-architecture.md §16.1.

CREATE TABLE IF NOT EXISTS blog_curation_stars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('item','asset')),
  blog_day_id UUID REFERENCES blog_days(id) ON DELETE CASCADE,
  blog_item_id UUID REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (
    (target_kind = 'item'  AND blog_item_id IS NOT NULL AND asset_id IS NULL) OR
    (target_kind = 'asset' AND asset_id     IS NOT NULL AND blog_item_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_star_item  ON blog_curation_stars(blog_item_id, user_id) WHERE blog_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_star_asset ON blog_curation_stars(asset_id, user_id)     WHERE asset_id     IS NOT NULL;

-- Backfill from the legacy blog_item_highlights table.
INSERT INTO blog_curation_stars (id, trip_id, target_kind, blog_item_id, user_id, created_at)
SELECT uuid_generate_v4(), i.trip_id, 'item', h.item_id, h.starred_by_user_id, h.created_at
FROM blog_item_highlights h
JOIN blog_items i ON i.id = h.item_id
ON CONFLICT DO NOTHING;
