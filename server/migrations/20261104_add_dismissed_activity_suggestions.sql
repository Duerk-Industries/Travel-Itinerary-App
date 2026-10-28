-- Template activities a traveler dismissed from the Activities page suggestions, per trip and per
-- traveler, so a dismissal stays dismissed on their other devices and visits.
CREATE TABLE IF NOT EXISTS trip_dismissed_suggestions (
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  suggestion_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id, suggestion_key)
);
