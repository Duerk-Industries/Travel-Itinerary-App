CREATE TABLE IF NOT EXISTS billing_trial_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_normalized TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_trial_usage_email ON billing_trial_usage(email_normalized);
CREATE INDEX IF NOT EXISTS idx_billing_trial_usage_user ON billing_trial_usage(user_id);
