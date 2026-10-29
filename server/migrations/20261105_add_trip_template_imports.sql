-- Itinerary templates and shared descriptions/pictures imported by an admin from a bundle (see
-- services/tripTemplateBundle.ts). They are read on top of the seed files in server/data/trip-templates,
-- so a new or corrected template goes live without a deploy. kind is 'template', 'place' or 'destination'.
CREATE TABLE IF NOT EXISTS trip_template_imports (
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  imported_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, item_key)
);
