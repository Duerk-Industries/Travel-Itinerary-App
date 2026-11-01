-- One to five stars a traveler gave a completed trip item. Earlier thumbs stay in item_votes under
-- the `<type>:rating` keys and count as 5 stars (up) or 1 star (down) until the traveler rates again.
CREATE TABLE IF NOT EXISTS item_ratings (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_type, item_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_item_ratings_trip_type_item ON item_ratings(trip_id, item_type, item_id);
