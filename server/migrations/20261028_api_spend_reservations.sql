CREATE TABLE IF NOT EXISTS api_spend_reservations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  window_key TEXT NOT NULL,
  amount_micros BIGINT NOT NULL,
  settled_micros BIGINT,
  dispatched_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_spend_reservations_window ON api_spend_reservations(provider, window_key);
