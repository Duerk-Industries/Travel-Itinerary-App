-- Stripe billing tables: customers, subscriptions, webhook event log.

CREATE TABLE IF NOT EXISTS billing_customers (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email_snapshot TEXT,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_stripe_id
  ON billing_customers(stripe_customer_id);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_scope TEXT NOT NULL DEFAULT 'individual',
  scope_owner_id UUID NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at TIMESTAMP,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  trial_end TIMESTAMP,
  ended_at TIMESTAMP,
  latest_invoice_id TEXT,
  past_due_since TIMESTAMP,
  access_revoked_at TIMESTAMP,
  access_revocation_reason TEXT,
  dispute_id TEXT,
  refunded_at TIMESTAMP,
  last_stripe_event_created BIGINT,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user
  ON billing_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer
  ON billing_subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status
  ON billing_subscriptions(status, user_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_object_id TEXT,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  event_created BIGINT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type
  ON stripe_webhook_events(event_type, received_at);
