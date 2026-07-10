CREATE TABLE IF NOT EXISTS billing_notifications (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL,
  notification_key       TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  message                TEXT NOT NULL,
  stripe_subscription_id TEXT,
  stripe_event_id        TEXT,
  email_sent_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_notifications_user_created
  ON billing_notifications(user_id, created_at DESC);
