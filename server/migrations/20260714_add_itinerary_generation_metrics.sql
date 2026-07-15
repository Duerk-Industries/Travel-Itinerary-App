CREATE TABLE IF NOT EXISTS itinerary_generation_metrics (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generation_id TEXT NOT NULL UNIQUE,
  trip_id       TEXT,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  metrics       JSONB NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_generation_metrics_created
  ON itinerary_generation_metrics(created_at DESC);
