CREATE TABLE IF NOT EXISTS ai_provider_config (
  feature_key TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
