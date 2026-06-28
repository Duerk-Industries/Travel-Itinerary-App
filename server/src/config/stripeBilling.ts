import { getEnvFlag, getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import type { BillingPlanKey } from '../types';

// Stripe API version — read from env so it can be changed without a code deploy.
// Must match the version pinned on the Dashboard webhook destination.
// Defaults to '2025-02-24.acacia'; set STRIPE_API_VERSION in server/.env to override.
export const STRIPE_API_VERSION = getEnvValue('STRIPE_API_VERSION') ?? '2025-02-24.acacia';

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

// Price IDs are set when Stripe Prices are created in the Dashboard.
// These are the active launch Prices; when a new Price is published (Phase 6 admin UI),
// the env vars (or DB billing_plan_config rows) are updated.
/** True when the configured secret key is a live-mode key (not a test key). */
export const isStripeLiveMode = (): boolean => {
  const key = getStripeSecretKey();
  return key != null && !key.startsWith('sk_test_');
};

export const getStripePremiumMonthlyPriceId = (): string | undefined =>
  getEnvValue('STRIPE_PREMIUM_MONTHLY_PRICE_ID');

export const getStripePremiumAnnualPriceId = (): string | undefined =>
  getEnvValue('STRIPE_PREMIUM_ANNUAL_PRICE_ID');

export const SUPPORTED_PLAN_KEYS: BillingPlanKey[] = ['premium_monthly', 'premium_annual'];

export const resolvePriceId = (planKey: BillingPlanKey): string => {
  const priceId =
    planKey === 'premium_monthly'
      ? getStripePremiumMonthlyPriceId()
      : getStripePremiumAnnualPriceId();
  if (!priceId) {
    throw new Error(
      `[stripe] No active Price ID configured for plan: ${planKey}. ` +
        `Set STRIPE_PREMIUM_MONTHLY_PRICE_ID or STRIPE_PREMIUM_ANNUAL_PRICE_ID.`,
    );
  }
  return priceId;
};

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

/**
 * Call after initDb(). Checks each plan's price against both the env var and
 * billing_plan_config, logging info when the env var is absent but a DB price
 * exists, and only erroring when neither source has a price configured.
 */
/**
 * Call after initDb(). Checks each plan's price against both the env var and
 * billing_plan_config, logging info when the env var is absent but a DB price
 * exists, and only erroring when neither source has a price configured.
 */
export const warnIfStripePricesUnconfigured = async (
  getBillingPlanConfig: (planKey: BillingPlanKey) => Promise<{ activeStripePriceId?: string | null } | null>,
): Promise<void> => {
  if (!isStripeBillingEnabled()) return;

  const plans: Array<{ key: BillingPlanKey; envGetter: () => string | undefined; envVar: string }> = [
    { key: 'premium_monthly', envGetter: getStripePremiumMonthlyPriceId, envVar: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' },
    { key: 'premium_annual',  envGetter: getStripePremiumAnnualPriceId,  envVar: 'STRIPE_PREMIUM_ANNUAL_PRICE_ID'  },
  ];

  for (const { key, envGetter, envVar } of plans) {
    const fromEnv = envGetter();
    if (fromEnv) continue; // env var is set — no warning needed

    const config = await getBillingPlanConfig(key);
    if (config?.activeStripePriceId) {
      logInfo(`[stripe] ${envVar} is not set — using active price from Admin UI (${config.activeStripePriceId})`);
    } else {
      logError(`[stripe] ${envVar} is not set and no active price exists in billing_plan_config — checkout will fail until a price is published via the Admin UI or this env var is configured`);
    }
  }
};
