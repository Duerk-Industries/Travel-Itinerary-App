import { getEnvFlag, getEnvValue } from '../env';
import { logError } from '../logger';

// Pinned Stripe API version — update deliberately, not by drift.
export const STRIPE_API_VERSION = '2025-02-24.acacia' as const;

// Phase 1: plan constants are hardcoded here.
// They move to the billing_plan_config DB table when the admin UI is built (Phase 6).
export const PLAN_DEFAULTS = {
  premiumMonthlyAmountCents: 500,
  premiumAnnualAmountCents: 3500,
  trialDays: 14,
  pastDueGraceDays: 30,
  automaticTaxEnabled: true,
  promotionCodesEnabled: true,
} as const;

// ---------------------------------------------------------------------------
// Environment accessors
// ---------------------------------------------------------------------------

export const isStripeBillingEnabled = (): boolean =>
  getEnvFlag('STRIPE_BILLING_ENABLED', { defaultValue: false });

export const getStripeSecretKey = (): string | undefined =>
  getEnvValue('STRIPE_SECRET_KEY');

export const getStripeWebhookSecret = (): string | undefined =>
  getEnvValue('STRIPE_WEBHOOK_SECRET');

export const getStripePremiumProductId = (): string | undefined =>
  getEnvValue('STRIPE_PREMIUM_PRODUCT_ID');

export const getStripePortalConfigurationId = (): string | undefined =>
  getEnvValue('STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID');

export const getStripeCheckoutSuccessUrl = (): string | undefined =>
  getEnvValue('STRIPE_CHECKOUT_SUCCESS_URL');

export const getStripeCheckoutCancelUrl = (): string | undefined =>
  getEnvValue('STRIPE_CHECKOUT_CANCEL_URL');

export const getStripePortalReturnUrl = (): string | undefined =>
  getEnvValue('STRIPE_PORTAL_RETURN_URL');

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

/**
 * Call at server startup (after initDb) when billing is enabled.
 * Throws with a clear message if any required secret is absent so Cloud Run
 * fails fast rather than serving with a broken billing integration.
 */
export const assertStripeBillingConfig = (): void => {
  if (!isStripeBillingEnabled()) return;

  const missing: string[] = [];

  if (!getStripeSecretKey()) missing.push('STRIPE_SECRET_KEY');
  if (!getStripeWebhookSecret()) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!getStripePremiumProductId()) missing.push('STRIPE_PREMIUM_PRODUCT_ID');
  if (!getStripeCheckoutSuccessUrl()) missing.push('STRIPE_CHECKOUT_SUCCESS_URL');
  if (!getStripeCheckoutCancelUrl()) missing.push('STRIPE_CHECKOUT_CANCEL_URL');
  if (!getStripePortalReturnUrl()) missing.push('STRIPE_PORTAL_RETURN_URL');

  if (missing.length > 0) {
    const msg = `[stripe] STRIPE_BILLING_ENABLED=true but required env vars are missing: ${missing.join(', ')}`;
    logError(msg);
    throw new Error(msg);
  }

  // Warn when test and live keys are mismatched so a developer catches it early.
  const secretKey = getStripeSecretKey()!;
  const isTestKey = secretKey.startsWith('sk_test_');
  const isLiveKey = secretKey.startsWith('sk_live_');
  if (!isTestKey && !isLiveKey) {
    logError('[stripe] STRIPE_SECRET_KEY does not begin with sk_test_ or sk_live_ — verify configuration');
  }
};
