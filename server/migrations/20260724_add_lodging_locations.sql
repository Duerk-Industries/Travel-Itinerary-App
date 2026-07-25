CREATE TABLE IF NOT EXISTS lodging_locations (
  place_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone_number TEXT,
  iana_timezone TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  last_lookup_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS lodging_location_id TEXT REFERENCES lodging_locations(place_id);
