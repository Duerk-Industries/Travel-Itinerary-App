-- Phase 5 of docs/trip-blog-social-implementation-plan.md — "what actually happened" (C1, C2, C3,
-- C5, C10, C11, A1, A2).

-- A1: acceptance rate is the stage-2 rollout gate for the Day Starter (architecture §8), so an
-- accepted starter must be distinguishable from any other core.text item after the fact. Nullable
-- and unconstrained (not an enum) since other authoring surfaces may want to stamp their own
-- provenance here later without another migration.
ALTER TABLE blog_items ADD COLUMN IF NOT EXISTS source_type TEXT;

-- C2/§14.1: tracks the currently-stored day-map artifact per (day, audience variant) so a
-- re-render can find and delete the object it supersedes, and so trip deletion can find every
-- object to reap. Deliberately NOT part of blog_media_assets/blog_storage_accounts — a generated
-- map is platform storage, never charged to any uploader's ledger (architecture §14.4) — so it
-- gets its own small tracking table instead of being shoehorned into the per-uploader media model.
CREATE TABLE IF NOT EXISTS blog_day_map_renders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  blog_day_id UUID NOT NULL REFERENCES blog_days(id) ON DELETE CASCADE,
  -- 'traveler' includes photo-geotag pins when photo_location_enabled is on; 'public' never does
  -- (threat S14) — two distinct stored images per day, not one image with a privacy flag.
  audience_variant TEXT NOT NULL CHECK (audience_variant IN ('traveler', 'public')),
  points_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  rendered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (blog_day_id, audience_variant)
);
CREATE INDEX IF NOT EXISTS idx_blog_day_map_renders_trip ON blog_day_map_renders(trip_id);
