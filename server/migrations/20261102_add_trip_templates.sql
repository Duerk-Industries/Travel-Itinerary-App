-- Itinerary templates offered for a destination. The itinerary content (stays, activities, transfers)
-- ships in the repo as seed data (server/data/trip-templates/*.json) and is read from there; this table
-- is the catalogue row that associates each template with the destinations it is offered for, and is
-- refreshed from the seed files at startup. content_hash notes which version of the seed file it holds.
CREATE TABLE IF NOT EXISTS trip_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  days INTEGER NOT NULL,
  route TEXT NOT NULL DEFAULT '',
  image_query TEXT NOT NULL DEFAULT '',
  countries JSONB NOT NULL DEFAULT '[]'::jsonb,
  cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
