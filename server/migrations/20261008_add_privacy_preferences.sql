CREATE TABLE IF NOT EXISTS privacy_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  product_analytics BOOLEAN,
  optional_diagnostics BOOLEAN,
  product_epoch INTEGER NOT NULL DEFAULT 0,
  diagnostics_epoch INTEGER NOT NULL DEFAULT 0,
  diagnostic_pseudonym UUID,
  revision INTEGER NOT NULL DEFAULT 0,
  notice_version TEXT,
  product_notice_version TEXT,
  diagnostics_notice_version TEXT,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS privacy_choice_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  notice_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS privacy_choice_events_user_time_idx
  ON privacy_choice_events (user_id, occurred_at);
