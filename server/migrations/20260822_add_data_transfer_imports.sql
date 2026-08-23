-- Durable idempotency receipts for activity/lodging CSV imports.
-- Kept migration-backed so fresh and existing Postgres deployments converge
-- through the normal migration runner rather than adding another inline table.
CREATE TABLE IF NOT EXISTS data_transfer_imports (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  import_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, trip_id, entity, import_id)
);
