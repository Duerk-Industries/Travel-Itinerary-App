-- Phase 3 (docs/implementation-plans/analytics-upgrade.md): trusted per-attempt cost ledger,
-- invoice reconciliation inputs, and durable job leases/cursors.
CREATE TABLE IF NOT EXISTS provider_cost_ledger (
  attempt_id            TEXT PRIMARY KEY,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_key            TEXT NOT NULL,
  provider              TEXT NOT NULL,
  model                 TEXT,
  caller                TEXT,
  feature_key           TEXT,
  user_id               TEXT,
  trip_id               TEXT,
  attribution           TEXT NOT NULL,
  unit_type             TEXT NOT NULL,
  prompt_tokens         INTEGER NOT NULL DEFAULT 0,
  completion_tokens     INTEGER NOT NULL DEFAULT 0,
  request_units         INTEGER NOT NULL DEFAULT 0,
  cache_status          TEXT NOT NULL DEFAULT 'none',
  outcome               TEXT NOT NULL,
  cost_status           TEXT NOT NULL,
  estimated_cost_micros BIGINT,
  price_version         TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_cost_ledger_window ON provider_cost_ledger(window_key, provider);
CREATE INDEX IF NOT EXISTS idx_provider_cost_ledger_user ON provider_cost_ledger(user_id);

CREATE TABLE IF NOT EXISTS provider_invoice_records (
  provider        TEXT NOT NULL,
  window_key      TEXT NOT NULL,
  invoiced_micros BIGINT NOT NULL,
  credits_micros  BIGINT NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  fx_rate_to_usd  DOUBLE PRECISION NOT NULL DEFAULT 1,
  notes           TEXT,
  recorded_by     TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, window_key)
);

CREATE TABLE IF NOT EXISTS job_leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  cursor     TEXT
);
