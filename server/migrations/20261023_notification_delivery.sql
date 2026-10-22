ALTER TABLE notifications ADD COLUMN IF NOT EXISTS in_app BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS notification_work (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, due_at BIGINT NOT NULL, lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0,
  data JSONB NOT NULL, completed BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS notification_work_due ON notification_work(completed,due_at,lease_until);
