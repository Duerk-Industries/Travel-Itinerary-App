--
-- Itinerary collaboration features (Phases 1 + 2 of
-- docs/implementation-plan-itinerary-collab.md), bundled into one migration
-- so the runner does a single BEGIN/COMMIT and writes a single
-- schema_migrations row per init. The earlier per-feature migration files
-- (20260427_add_itinerary_detail_reactions.sql,
-- 20260427_add_itinerary_item_kinds.sql,
-- 20260427_add_itinerary_checklist_items.sql) were consolidated here before
-- any production deploy; they remain on disk only as `.skipped` companions
-- so historical context is preserved.
--
-- 1. Reactions table — per-detail up/down votes (Phase 1).
-- 2. Item-kind columns — typed itinerary detail rows (Phase 2).
-- 3. Checklist children table — toggleable child items for kind='checklist'.

CREATE TABLE IF NOT EXISTS itinerary_detail_reactions (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  detail_id UUID NOT NULL REFERENCES itinerary_details(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (detail_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_detail_reactions_trip_detail
  ON itinerary_detail_reactions(trip_id, detail_id);

ALTER TABLE itinerary_details
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'activity';

ALTER TABLE itinerary_details
  ADD COLUMN IF NOT EXISTS place_id TEXT;

ALTER TABLE itinerary_details
  ADD COLUMN IF NOT EXISTS note_body TEXT;

ALTER TABLE itinerary_details
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS itinerary_checklist_items (
  id UUID PRIMARY KEY,
  detail_id UUID NOT NULL REFERENCES itinerary_details(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  checked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_checklist_items_detail
  ON itinerary_checklist_items(detail_id, position);
