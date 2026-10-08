-- Phase 2 (docs/implementation-plans/analytics-upgrade.md): product analytics store.

-- Random pseudonym per account and product-analytics consent epoch. Regranting after a
-- withdrawal starts a new epoch, so post-regrant events cannot be stitched to earlier ones.
CREATE TABLE IF NOT EXISTS analytics_subjects (
  subject_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  product_epoch INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, product_epoch)
);
CREATE INDEX IF NOT EXISTS idx_analytics_subjects_user ON analytics_subjects(user_id);

-- One row per accepted event. id = subject:epoch:event_id, so a retried batch is idempotent.
CREATE TABLE IF NOT EXISTS analytics_events (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  purpose_epoch    INTEGER NOT NULL,
  event_name       TEXT NOT NULL,
  family           TEXT NOT NULL,
  source           TEXT NOT NULL,
  feature          TEXT,
  platform         TEXT NOT NULL,
  app_version      TEXT NOT NULL,
  session_id       TEXT,
  trip_ref         TEXT,
  trip_phase       TEXT NOT NULL,
  timezone_source  TEXT NOT NULL,
  date_version     TEXT,
  properties       TEXT NOT NULL,
  schema_version   INTEGER NOT NULL,
  excluded_reason  TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_time ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_subject ON analytics_events(subject_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events(event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_expiry ON analytics_events(expires_at);
