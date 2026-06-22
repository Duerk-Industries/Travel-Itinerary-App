-- billing_plan_config: admin-editable per-plan settings (Phase 6)
CREATE TABLE IF NOT EXISTS billing_plan_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_key TEXT NOT NULL UNIQUE,
  stripe_product_id TEXT,
  active_stripe_price_id TEXT,
  unit_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month',
  trial_days INTEGER NOT NULL DEFAULT 14,
  past_due_grace_days INTEGER NOT NULL DEFAULT 30,
  automatic_tax_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  promotion_codes_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_checkout_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  livemode BOOLEAN,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- billing_price_history: immutable log of Stripe Prices created via admin UI
CREATE TABLE IF NOT EXISTS billing_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stripe_price_id TEXT NOT NULL UNIQUE,
  plan_key TEXT NOT NULL,
  stripe_product_id TEXT,
  unit_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT NOT NULL DEFAULT 'month',
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  active_for_new_checkout BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_price_history_plan_key
  ON billing_price_history(plan_key);
CREATE INDEX IF NOT EXISTS idx_billing_price_history_active
  ON billing_price_history(plan_key, active_for_new_checkout) WHERE active_for_new_checkout = TRUE;

-- Seed default plan config rows.
-- These match PLAN_DEFAULTS in stripeBilling.ts; the DB rows win at runtime.
INSERT INTO billing_plan_config (id, plan_key, unit_amount_cents, currency, interval, trial_days, past_due_grace_days)
VALUES ('00000000-0000-4000-8000-000000000001', 'premium_monthly', 500, 'usd', 'month', 14, 30)
ON CONFLICT (plan_key) DO NOTHING;

INSERT INTO billing_plan_config (id, plan_key, unit_amount_cents, currency, interval, trial_days, past_due_grace_days)
VALUES ('00000000-0000-4000-8000-000000000002', 'premium_annual', 3500, 'usd', 'year', 14, 30)
ON CONFLICT (plan_key) DO NOTHING;
