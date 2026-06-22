CREATE TABLE IF NOT EXISTS billing_checkout_claims (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  stripe_checkout_session_id TEXT,
  checkout_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_claims_expires
  ON billing_checkout_claims(expires_at);
