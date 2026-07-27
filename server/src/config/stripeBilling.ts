import { getEnvFlag, getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import type { BillingPlanKey } from '../types';

// Stripe API version — read from env so it can be changed without a code deploy.
// Must match the version pinned on the Dashboard webhook destination.
// Defaults to the current dahlia API version recommended for this integration.
export const STRIPE_API_VERSION = getEnvValue('STRIPE_API_VERSION') ?? '2026-06-24.dahlia';

// Phase 1: plan constants are hardcoded here.
// They move to the billing_plan_config DB table when the admin UI is built (Phase 6).
export const PLAN_DEFAULTS = {
  premiumMonthlyAmountCents: 500,
  premiumAnnualAmountCents: 3500,
  trialDays: 14,
  pastDueGraceDays: 14,
  automaticTaxEnabled: true,
  promotionCodesEnabled: false,
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

export const isStripeTaxConfigurationRequired = (): boolean =>
  getEnvFlag('STRIPE_REQUIRE_TAX_CONFIGURATION', { defaultValue: false });

export const isStripeTaxConfigurationConfirmed = (): boolean =>
  getEnvFlag('STRIPE_TAX_CONFIGURED', { defaultValue: false });

// Price IDs are set when Stripe Prices are created in the Dashboard.
// These are the active launch Prices; when a new Price is published (Phase 6 admin UI),
// the env vars (or DB billing_plan_config rows) are updated.
const isStripeTestModeKey = (key: string): boolean =>
  key.startsWith('sk_test_') || key.startsWith('rk_test_');

const isStripeLiveModeKey = (key: string): boolean =>
  key.startsWith('sk_live_') || key.startsWith('rk_live_');

/** True when the configured Stripe API key is a live-mode key (not a test key). */
export const isStripeLiveMode = (): boolean => {
  const key = getStripeSecretKey();
  return key != null && isStripeLiveModeKey(key);
};

export const getStripePremiumMonthlyPriceId = (): string | undefined =>
  getEnvValue('STRIPE_PREMIUM_MONTHLY_PRICE_ID');

export const getStripePremiumAnnualPriceId = (): string | undefined =>
  getEnvValue('STRIPE_PREMIUM_ANNUAL_PRICE_ID');

export const getStripeStorage20gbPriceId = (): string | undefined =>
  getEnvValue('STRIPE_STORAGE_20GB_PRICE_ID');

export const getStripeStorage100gbPriceId = (): string | undefined =>
  getEnvValue('STRIPE_STORAGE_100GB_PRICE_ID');

export const getStripeStorage200gbPriceId = (): string | undefined =>
  getEnvValue('STRIPE_STORAGE_200GB_PRICE_ID');

export const getStripeStorage2tbPriceId = (): string | undefined =>
  getEnvValue('STRIPE_STORAGE_2TB_PRICE_ID');

export const getStorageAddonBytesMapping = (): Record<string, number> => {
  const mapping: Record<string, number> = {};
  const p20 = getStripeStorage20gbPriceId();
  if (p20) mapping[p20] = 20 * 1024 ** 3;
  const p100 = getStripeStorage100gbPriceId();
  if (p100) mapping[p100] = 100 * 1024 ** 3;
  const p200 = getStripeStorage200gbPriceId();
  if (p200) mapping[p200] = 200 * 1024 ** 3;
  const p2t = getStripeStorage2tbPriceId();
  if (p2t) mapping[p2t] = 2 * 1024 ** 4;
  return mapping;
};

export const SUPPORTED_PLAN_KEYS: BillingPlanKey[] = [
  'premium_monthly',
  'premium_annual',
  'storage_20gb',
  'storage_100gb',
  'storage_200gb',
  'storage_2tb',
];

export const resolvePriceId = (planKey: BillingPlanKey): string => {
  let priceId: string | undefined;
  switch (planKey) {
    case 'premium_monthly': priceId = getStripePremiumMonthlyPriceId(); break;
    case 'premium_annual':  priceId = getStripePremiumAnnualPriceId();  break;
    case 'storage_20gb':    priceId = getStripeStorage20gbPriceId();    break;
    case 'storage_100gb':   priceId = getStripeStorage100gbPriceId();   break;
    case 'storage_200gb':   priceId = getStripeStorage200gbPriceId();   break;
    case 'storage_2tb':     priceId = getStripeStorage2tbPriceId();     break;
  }
  if (!priceId) {
    throw new Error(
      `[stripe] No active Price ID configured for plan: ${planKey}. ` +
        `Check your environment variables.`,
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

  if (PLAN_DEFAULTS.automaticTaxEnabled && isStripeTaxConfigurationRequired() && !isStripeTaxConfigurationConfirmed()) {
    const msg = '[stripe] Stripe Tax is required but STRIPE_TAX_CONFIGURED=true is not set. Configure Stripe Tax origin address, tax code, and tax registrations in the Stripe Dashboard before enabling automatic tax.';
    logError(msg);
    throw new Error(msg);
  }

  // Warn when test and live keys are mismatched so a developer catches it early.
  const secretKey = getStripeSecretKey()!;
  const isTestKey = isStripeTestModeKey(secretKey);
  const isLiveKey = isStripeLiveModeKey(secretKey);
  if (!isTestKey && !isLiveKey) {
    logError('[stripe] STRIPE_SECRET_KEY does not begin with sk_test_, sk_live_, rk_test_, or rk_live_ — verify configuration');
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
