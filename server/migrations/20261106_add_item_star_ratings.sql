-- A traveler's 1-5 star rating of a booked item (flight/transfer, lodging, activity, car rental), kept per item so
-- we can show what they gave, and per provider (provider_key: the hotel, airline, rental company or activity the
-- item is a booking of) so every traveler's ratings of the same provider can be averaged. updated_at is the last
-- time the traveler changed it. No foreign keys on trip or item: a provider's ratings outlive any one trip.
CREATE TABLE IF NOT EXISTS item_star_ratings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_item_star_ratings_provider ON item_star_ratings(item_type, provider_key);
