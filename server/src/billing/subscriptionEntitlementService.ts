import {
  getUserRole,
  getCurrentUserTier,
  setUserTier,
  writeAuditLog,
  listActiveBillingSubscriptionsForUser,
  listBillingPlanConfigs,
} from '../db';
import { BillingSubscription, BillingSubscriptionStatus, TierKey } from '../types';
import { logInfo, logError } from '../logger';
import { PLAN_DEFAULTS } from '../config/stripeBilling';

// ---------------------------------------------------------------------------
// Eligibility logic
// ---------------------------------------------------------------------------

const PREMIUM_ELIGIBLE_STATUSES: BillingSubscriptionStatus[] = ['trialing', 'active', 'past_due'];

/**
 * Whether a single Stripe subscription currently grants Premium access.
 * `access_revoked_at` (set by refund/dispute logic) always overrides status.
 * `past_due` subscriptions are eligible only within the configured grace period.
 */
export const isSubscriptionPremiumEligible = (
  sub: BillingSubscription,
  pastDueGraceDays: number = PLAN_DEFAULTS.pastDueGraceDays,
): boolean => {
  if (sub.accessRevokedAt) return false;

  if (sub.pastDueSince) {
    const gracePeriodMs = pastDueGraceDays * 24 * 60 * 60 * 1000;
    return Date.now() - new Date(sub.pastDueSince).getTime() < gracePeriodMs;
  }

  return PREMIUM_ELIGIBLE_STATUSES.includes(sub.status);
};

export interface BillingEntitlementDecision {
  shouldHavePremium: boolean;
  eligibleSubscriptionId: string | null;
  reason: string;
}

/**
 * Pure function: given a set of billing subscriptions, compute whether the user
 * should have Premium. Does NOT write to the database.
 */
export const computeBillingEntitlementDecision = (
  subscriptions: BillingSubscription[],
  graceDaysByPlan: Partial<Record<BillingSubscription['planKey'], number>> = {},
): BillingEntitlementDecision => {
  const eligible = subscriptions.find((sub) =>
    isSubscriptionPremiumEligible(sub, graceDaysByPlan[sub.planKey]),
  );
  if (eligible) {
    return {
      shouldHavePremium: true,
      eligibleSubscriptionId: eligible.stripeSubscriptionId,
      reason: `Subscription ${eligible.stripeSubscriptionId} is eligible (status: ${eligible.status})`,
    };
  }
  const mostRecent = subscriptions[0];
  const reason = mostRecent
    ? `No eligible subscription — most recent (${mostRecent.stripeSubscriptionId}) has status: ${mostRecent.status}${mostRecent.accessRevokedAt ? ', access revoked' : ''}`
    : 'No Stripe subscriptions found for this user';
  return { shouldHavePremium: false, eligibleSubscriptionId: null, reason };
};

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileContext {
  stripeSubscriptionId?: string;
  stripeEventId?: string;
  reason: string;
}

export interface ReconcileResult {
  changed: boolean;
  from: TierKey | null;
  to: TierKey;
  skipped?: 'admin_role' | 'admin_override';
}

/**
 * Applies the billing entitlement decision to the user's tier row.
 *
 * Precedence (highest wins):
 *  1. Admin role — never touched; billing cannot change an admin's tier.
 *  2. source = 'admin_override' — billing cannot overwrite an explicit admin grant.
 *  3. Eligible Stripe subscription → 'premium'.
 *  4. No eligible subscription → 'free'.
 *
 * Safe to call repeatedly — no-ops when the tier is already correct.
 * Writes an audit log entry on every actual change.
 */
export const reconcileUserTierFromBilling = async (
  userId: string,
  subscriptions: BillingSubscription[],
  context: ReconcileContext,
): Promise<ReconcileResult> => {
  // 1. Never touch admin users — their tier is managed by the admin bootstrap path.
  const role = await getUserRole(userId);
  if (role === 'admin') {
    logInfo(`[billing-entitlement] Skipping reconciliation for admin user ${userId}`);
    return { changed: false, from: null, to: 'pro', skipped: 'admin_role' };
  }

  // 2. Never overwrite an explicit admin override.
  const currentTier = await getCurrentUserTier(userId);
  if (currentTier?.source === 'admin_override') {
    logInfo(
      `[billing-entitlement] Skipping reconciliation for user ${userId} — current source is admin_override`,
    );
    return {
      changed: false,
      from: currentTier.tierKey as TierKey,
      to: currentTier.tierKey as TierKey,
      skipped: 'admin_override',
    };
  }

  // 3. Determine desired tier from billing state.
  const configs = await listBillingPlanConfigs();
  const graceDaysByPlan = Object.fromEntries(configs.map((config) => [config.planKey, config.pastDueGraceDays]));
  const decision = computeBillingEntitlementDecision(subscriptions, graceDaysByPlan);
  const desiredTier: TierKey = decision.shouldHavePremium ? 'premium' : 'free';
  const currentTierKey = (currentTier?.tierKey ?? 'free') as TierKey;

  // 4. No-op if already correct.
  if (currentTierKey === desiredTier) {
    return { changed: false, from: currentTierKey, to: desiredTier };
  }

  // 5. Apply.
  const auditReason = [
    context.reason,
    decision.reason,
    context.stripeSubscriptionId ? `Subscription: ${context.stripeSubscriptionId}` : null,
    context.stripeEventId ? `Event: ${context.stripeEventId}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  try {
    await setUserTier(userId, desiredTier, 'billing', null, auditReason);
    await writeAuditLog({
      actorUserId: null,
      targetUserId: userId,
      action: 'USER_TIER_CHANGED',
      beforeState: { tierKey: currentTierKey, source: currentTier?.source ?? null },
      afterState: {
        tierKey: desiredTier,
        source: 'billing',
        stripeSubscriptionId: context.stripeSubscriptionId ?? null,
        stripeEventId: context.stripeEventId ?? null,
      },
      reason: auditReason,
    });
    logInfo(
      `[billing-entitlement] Tier changed for user ${userId}: ${currentTierKey} → ${desiredTier}. ${decision.reason}`,
    );
  } catch (err) {
    logError(`[billing-entitlement] Failed to apply tier change for user ${userId}`, {
      desiredTier,
      stripeSubscriptionId: context.stripeSubscriptionId,
      stripeEventId: context.stripeEventId,
      error: (err as Error)?.message,
    });
    throw err;
  }

  return { changed: true, from: currentTierKey, to: desiredTier };
};

/**
 * Convenience wrapper: fetches current billing subscriptions from the DB then reconciles.
 * Use when you have a userId but not the pre-fetched subscription list.
 */
export const reconcileUserTierFromBillingById = async (
  userId: string,
  context: ReconcileContext,
): Promise<ReconcileResult> => {
  const subscriptions = await listActiveBillingSubscriptionsForUser(userId);
  return reconcileUserTierFromBilling(userId, subscriptions, context);
};
