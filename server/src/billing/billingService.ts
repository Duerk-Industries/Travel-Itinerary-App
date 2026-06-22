import Stripe from 'stripe';
import {
  getBillingCustomerByUserId,
  getBillingCustomerByStripeId,
  upsertBillingCustomer,
  listActiveBillingSubscriptionsForUser,
  upsertBillingSubscription,
  getCurrentUserTier,
  ensureCurrentUserTier,
  getBillingPlanConfig,
  listBillingPlanConfigs,
  listBillingPriceHistory,
  claimBillingCheckout,
  completeBillingCheckoutClaim,
  releaseBillingCheckoutClaim,
} from '../db';
import { BillingCustomer, BillingPlanKey, BillingSubscription, TierKey, UserRole } from '../types';
import { logInfo, logError } from '../logger';
import { incrementMetric } from '../metrics';
import {
  PLAN_DEFAULTS,
  SUPPORTED_PLAN_KEYS,
  resolvePriceId,
  getStripeCheckoutSuccessUrl,
  getStripeCheckoutCancelUrl,
  getStripePortalReturnUrl,
  getStripePortalConfigurationId,
  getStripePremiumMonthlyPriceId,
  getStripePremiumAnnualPriceId,
  isStripeBillingEnabled,
} from '../config/stripeBilling';
import { getStripeClient, normalizeStripeError } from './stripeClient';
import {
  isSubscriptionPremiumEligible,
} from './subscriptionEntitlementService';
import type {
  BillingStatusDto,
  CreateCheckoutSessionResult,
  PlanInfo,
} from './billingDtos';

// ---------------------------------------------------------------------------
// Customer management
// ---------------------------------------------------------------------------

/**
 * Returns an existing Stripe Customer for this user, or creates one and
 * persists the mapping. Safe to call concurrently — the DB UNIQUE constraint
 * on user_id prevents duplicate local records; a race that creates two Stripe
 * Customers will orphan the second one (acceptable for launch volume).
 */
export const getOrCreateBillingCustomer = async (
  userId: string,
  email: string,
  livemode: boolean,
): Promise<BillingCustomer> => {
  const existing = await getBillingCustomerByUserId(userId);
  if (existing) return existing;

  const stripe = getStripeClient();
  let stripeCustomer: Stripe.Customer;
  try {
    stripeCustomer = await stripe.customers.create({
      email,
      metadata: { userId, environment: livemode ? 'production' : 'test' },
    });
    incrementMetric('billing.customer_created');
  } catch (err) {
    const normalized = normalizeStripeError(err);
    logError('[billing] Failed to create Stripe customer', {
      userId,
      kind: normalized.kind,
      code: normalized.code,
      message: normalized.message,
    });
    incrementMetric('billing.customer_create_failed');
    throw err;
  }

  return upsertBillingCustomer({
    userId,
    stripeCustomerId: stripeCustomer.id,
    emailSnapshot: email,
    livemode,
  });
};

// ---------------------------------------------------------------------------
// Plan catalog
// ---------------------------------------------------------------------------

export const listAvailablePlans = async (): Promise<PlanInfo[]> => {
  const configs = await listBillingPlanConfigs();
  return configs
    .filter((config) => config.isCheckoutEnabled)
    .map((config) => ({
      planKey: config.planKey,
      amountCents: config.unitAmountCents,
      currency: config.currency,
      interval: config.interval,
      trialDays: config.trialDays,
    }));
};

export const resolvePlanKeyForPriceId = async (
  stripePriceId: string,
  metadataPlanKey?: string | null,
): Promise<BillingPlanKey> => {
  if (stripePriceId === getStripePremiumMonthlyPriceId()) return 'premium_monthly';
  if (stripePriceId === getStripePremiumAnnualPriceId()) return 'premium_annual';

  const configs = await listBillingPlanConfigs();
  const configured = configs.find((config) => config.activeStripePriceId === stripePriceId);
  if (configured) return configured.planKey;

  const history = await listBillingPriceHistory();
  const historical = history.find((price) => price.stripePriceId === stripePriceId);
  if (historical) return historical.planKey;

  if (metadataPlanKey === 'premium_monthly' || metadataPlanKey === 'premium_annual') {
    return metadataPlanKey;
  }
  throw new Error(`[billing] Cannot resolve plan for Stripe Price ${stripePriceId}`);
};

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export const createCheckoutSession = async (params: {
  userId: string;
  email: string;
  planKey: BillingPlanKey;
  idempotencyKey: string;
  livemode: boolean;
}): Promise<CreateCheckoutSessionResult> => {
  const { userId, email, planKey, idempotencyKey, livemode } = params;
  const claimToken = `${idempotencyKey}:${Date.now()}`;
  const claimExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  if (!SUPPORTED_PLAN_KEYS.includes(planKey)) {
    throw new Error(`Unsupported plan key: ${planKey}`);
  }

  // Prevent duplicate active subscriptions.
  // Note: there is a small TOCTOU window where two concurrent requests with different
  // idempotency keys could both pass this check before either checkout session completes.
  // The webhook-based upsert is idempotent, so the worst outcome is two Stripe sessions
  // being created; only the first webhook to land will activate a subscription.
  const existing = await listActiveBillingSubscriptionsForUser(userId);
  const alreadyActive = existing.some((subscription) => isSubscriptionPremiumEligible(subscription));
  if (alreadyActive) {
    incrementMetric('billing.checkout_blocked_already_subscribed');
    return {
      alreadySubscribed: true,
      message: 'You already have an active Premium subscription. Use Manage Subscription to make changes.',
    };
  }

  const planConfig = await getBillingPlanConfig(planKey);
  if (planConfig && !planConfig.isCheckoutEnabled) {
    throw new Error(`Checkout is disabled for plan: ${planKey}`);
  }
  if (planConfig?.livemode != null && planConfig.livemode !== livemode) {
    throw new Error(`The active billing configuration for ${planKey} belongs to the wrong Stripe mode`);
  }
  const priceId = planConfig?.activeStripePriceId ?? resolvePriceId(planKey);
  const successUrl = getStripeCheckoutSuccessUrl();
  const cancelUrl = getStripeCheckoutCancelUrl();

  if (!successUrl || !cancelUrl) {
    throw new Error('[billing] STRIPE_CHECKOUT_SUCCESS_URL and STRIPE_CHECKOUT_CANCEL_URL must be configured');
  }

  const claim = await claimBillingCheckout({
    userId,
    claimToken,
    planKey,
    expiresAt: claimExpiresAt,
  });
  if (!claim.claimed) {
    if (claim.checkoutUrl) return { url: claim.checkoutUrl };
    return {
      alreadySubscribed: true,
      message: 'A Premium checkout is already being created. Wait a moment and try again.',
    };
  }

  const customer = await getOrCreateBillingCustomer(userId, email, livemode);
  const stripe = getStripeClient();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customer.stripeCustomerId,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: planConfig?.trialDays ?? PLAN_DEFAULTS.trialDays,
          metadata: { userId, planKey },
        },
        metadata: { userId, planKey },
        success_url: successUrl,
        cancel_url: cancelUrl,
        automatic_tax: { enabled: planConfig?.automaticTaxEnabled ?? PLAN_DEFAULTS.automaticTaxEnabled },
        // Required so automatic tax always has a billing address to calculate from,
        // including wallet payments (Apple Pay, Google Pay) that may not supply one.
        billing_address_collection: 'required',
        allow_promotion_codes: planConfig?.promotionCodesEnabled ?? PLAN_DEFAULTS.promotionCodesEnabled,
        payment_method_collection: 'always',
        // Persist billing address and name back to the Stripe Customer so
        // automatic tax has a customer location for future renewal invoices.
        customer_update: { address: 'auto', name: 'auto' },
      },
      { idempotencyKey },
    );
    incrementMetric('billing.checkout_session_created', { planKey });
    logInfo(`[billing] Checkout session created for user ${userId}, plan ${planKey}`);
    if (!session.url) {
      throw new Error('[billing] Stripe returned a Checkout session without a URL');
    }
    await completeBillingCheckoutClaim({
      userId,
      claimToken,
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  } catch (err) {
    await releaseBillingCheckoutClaim(userId, claimToken).catch(() => undefined);
    const normalized = normalizeStripeError(err);
    logError('[billing] Failed to create Checkout session', {
      userId,
      planKey,
      kind: normalized.kind,
      code: normalized.code,
      message: normalized.message,
    });
    incrementMetric('billing.checkout_session_failed', { planKey });
    throw err;
  }

  return { url: session.url! };
};

// ---------------------------------------------------------------------------
// Customer Portal
// ---------------------------------------------------------------------------

export const createPortalSession = async (params: {
  userId: string;
}): Promise<{ url: string }> => {
  const { userId } = params;

  const customer = await getBillingCustomerByUserId(userId);
  if (!customer) {
    throw new Error('No billing account found. Complete a subscription first.');
  }

  const resolvedReturnUrl = getStripePortalReturnUrl();
  if (!resolvedReturnUrl) {
    throw new Error('[billing] STRIPE_PORTAL_RETURN_URL must be configured');
  }

  const stripe = getStripeClient();
  const portalConfigId = getStripePortalConfigurationId();

  let portalSession: Stripe.BillingPortal.Session;
  try {
    portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: resolvedReturnUrl,
      ...(portalConfigId ? { configuration: portalConfigId } : {}),
    });
    incrementMetric('billing.portal_session_created');
    logInfo(`[billing] Portal session created for user ${userId}`);
  } catch (err) {
    const normalized = normalizeStripeError(err);
    logError('[billing] Failed to create portal session', {
      userId,
      kind: normalized.kind,
      code: normalized.code,
      message: normalized.message,
    });
    incrementMetric('billing.portal_session_failed');
    throw err;
  }

  return { url: portalSession.url };
};

// ---------------------------------------------------------------------------
// Billing status
// ---------------------------------------------------------------------------

const planKeyToInterval = (planKey: BillingPlanKey | string | null): 'monthly' | 'annual' | null => {
  if (planKey === 'premium_monthly') return 'monthly';
  if (planKey === 'premium_annual') return 'annual';
  return null;
};

/**
 * Returns a normalized billing status for the authenticated user.
 * Used by GET /api/billing/status.
 */
export const getBillingStatus = async (
  userId: string,
  role: UserRole,
): Promise<BillingStatusDto> => {
  await ensureCurrentUserTier(userId, 'free');
  const [currentTier, subscriptions, planConfigs] = await Promise.all([
    getCurrentUserTier(userId),
    listActiveBillingSubscriptionsForUser(userId),
    listBillingPlanConfigs(),
  ]);

  const effectiveTier = (currentTier?.tierKey ?? 'free') as TierKey;
  const graceDaysByPlan = Object.fromEntries(planConfigs.map((config) => [config.planKey, config.pastDueGraceDays]));
  // Find the most relevant subscription to surface status from
  const primarySub: BillingSubscription | undefined =
    subscriptions.find((sub) => isSubscriptionPremiumEligible(sub, graceDaysByPlan[sub.planKey])) ?? subscriptions[0];

  const isBillingManaged = currentTier?.source === 'billing';
  const checkoutAvailable =
    isStripeBillingEnabled() &&
    planConfigs.some((config) => config.isCheckoutEnabled) &&
    !subscriptions.some((sub) => isSubscriptionPremiumEligible(sub, graceDaysByPlan[sub.planKey]));
  const portalAvailable = isStripeBillingEnabled() && subscriptions.length > 0;

  if (!primarySub) {
    return {
      effectiveTier,
      isBillingManaged,
      plan: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      inGracePeriod: false,
      accessRevoked: false,
      checkoutAvailable,
      portalAvailable,
    };
  }

  const inGracePeriod =
    primarySub.status === 'past_due' &&
    Boolean(primarySub.pastDueSince) &&
    isSubscriptionPremiumEligible(primarySub, graceDaysByPlan[primarySub.planKey]);

  return {
    effectiveTier,
    isBillingManaged,
    plan: planKeyToInterval(primarySub.planKey),
    subscriptionStatus: primarySub.status,
    currentPeriodEnd: primarySub.currentPeriodEnd,
    cancelAtPeriodEnd: primarySub.cancelAtPeriodEnd,
    inGracePeriod,
    accessRevoked: Boolean(primarySub.accessRevokedAt),
    checkoutAvailable,
    portalAvailable,
  };
};

// ---------------------------------------------------------------------------
// Subscription snapshot helper (used by webhook handler, Phase 5)
// ---------------------------------------------------------------------------

/**
 * Converts a live Stripe Subscription object into the shape expected by
 * upsertBillingSubscription. Centralises field mapping so the webhook
 * handler and any future callers stay in sync.
 */
export const mapStripeSubscriptionToUpsert = (
  sub: Stripe.Subscription,
  userId: string,
  planKey: BillingPlanKey,
  eventCreated?: number,
): Parameters<typeof upsertBillingSubscription>[0] => ({
  stripeSubscriptionId: sub.id,
  userId,
  scopeOwnerId: userId,
  stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
  stripePriceId: sub.items.data[0]?.price.id ?? '',
  planKey,
  status: sub.status as BillingSubscription['status'],
  livemode: sub.livemode,
  cancelAtPeriodEnd: sub.cancel_at_period_end,
  cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
  currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
  currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
  trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
  endedAt: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
  latestInvoiceId: typeof sub.latest_invoice === 'string' ? sub.latest_invoice : (sub.latest_invoice?.id ?? null),
  lastStripeEventCreated: eventCreated ?? null,
});

export const syncUserSubscriptionsFromStripe = async (userId: string): Promise<void> => {
  const customer = await getBillingCustomerByUserId(userId);
  if (!customer) return;

  const stripe = getStripeClient();
  const subscriptions = await stripe.subscriptions.list({
    customer: customer.stripeCustomerId,
    status: 'all',
    limit: 100,
  });
  for (const subscription of subscriptions.data) {
    const priceId = subscription.items.data[0]?.price.id;
    if (!priceId) continue;
    const planKey = await resolvePlanKeyForPriceId(priceId, subscription.metadata?.planKey);
    await upsertBillingSubscription(
      mapStripeSubscriptionToUpsert(subscription, userId, planKey),
    );
  }
};
