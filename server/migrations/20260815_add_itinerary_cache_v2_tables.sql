-- Itinerary cache v2 tables (binding-plan-v2 cache, curated block/location
-- corpus, and the shared API-capacity reservation ledger). These previously
-- lived as inline `CREATE TABLE IF NOT EXISTS` statements in db.postgres.ts's
-- initDb() bootstrap; moved into a migration per project convention (new
-- tables belong in a migration, not the inline bootstrap). All four
-- statements are unchanged from their prior inline form, so this is a no-op
-- on any database that already has them from the earlier inline bootstrap.

CREATE TABLE IF NOT EXISTS itinerary_binding_plan_cache (
  cache_key TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  corpus_release_id TEXT NOT NULL,
  template_revision TEXT NOT NULL,
  validator_revision TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  compression TEXT NOT NULL DEFAULT 'none',
  fresh_until TIMESTAMP NOT NULL,
  stale_until TIMESTAMP NOT NULL,
  hard_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_cache_cleanup ON itinerary_binding_plan_cache(hard_expires_at);

CREATE TABLE IF NOT EXISTS itinerary_blocks (
  block_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  role TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  interest_weights JSONB NOT NULL,
  energy_cost INTEGER NOT NULL,
  duration_typical INTEGER NOT NULL,
  source TEXT NOT NULL,
  release_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_blocks_location ON itinerary_blocks(location_id, release_id);

CREATE TABLE IF NOT EXISTS itinerary_location_profiles (
  location_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  release_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capacity_reservations (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  caller TEXT NOT NULL,
  units INTEGER NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  committed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capacity_reservations_expiry ON capacity_reservations(expires_at) WHERE committed = FALSE;
