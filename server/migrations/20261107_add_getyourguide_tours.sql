-- GetYourGuide tours matched to itinerary activities, synced at startup from
-- server/data/getyourguide-tours.json. `activities` holds the exact activity names a tour covers.
CREATE TABLE IF NOT EXISTS getyourguide_tours (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  rating NUMERIC(3, 2) NOT NULL,
  review_count INTEGER NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  activities JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
