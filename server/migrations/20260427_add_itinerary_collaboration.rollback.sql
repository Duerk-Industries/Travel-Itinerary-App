-- Manual rollback for 20260427_add_itinerary_collaboration.sql.
-- Reverses the full Phase 1 + Phase 2 itinerary collaboration migration.

DROP INDEX IF EXISTS idx_itinerary_checklist_items_detail;
DROP TABLE IF EXISTS itinerary_checklist_items;

ALTER TABLE itinerary_details DROP COLUMN IF EXISTS position;
ALTER TABLE itinerary_details DROP COLUMN IF EXISTS note_body;
ALTER TABLE itinerary_details DROP COLUMN IF EXISTS place_id;
ALTER TABLE itinerary_details DROP COLUMN IF EXISTS kind;

DROP INDEX IF EXISTS idx_itinerary_detail_reactions_trip_detail;
DROP TABLE IF EXISTS itinerary_detail_reactions;
