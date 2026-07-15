CREATE TABLE IF NOT EXISTS itinerary_comparisons (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_path                TEXT NOT NULL,
  gold_capture_id             TEXT,
  production_capture_id       TEXT,
  gold_item_count             INTEGER,
  production_item_count       INTEGER,
  item_count_delta            INTEGER,
  gold_days                   INTEGER,
  production_days             INTEGER,
  attraction_coverage_percent DECIMAL,
  gold_structural_issues      JSONB,
  production_structural_issues JSONB,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_comparisons_created
  ON itinerary_comparisons(created_at DESC);
