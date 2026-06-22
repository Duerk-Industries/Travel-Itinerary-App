import Stripe from 'stripe';
import {
  listStaleSubscriptionsForReconciliation,
  upsertBillingSubscription,
  getBillingSubscriptionByStripeId,
  writeAuditLog,
} from '../db';
import { BillingSubscription, BillingPlanKey } from '../types';
import { logInfo, logError } from '../logger';
import { incrementMetric } from '../metrics';
import { getEnvFlag, getEnvValue } from '../env';
import { isStripeBillingEnabled } from '../config/stripeBilling';
import { getStripeClient, normalizeStripeError } from './stripeClient';
import { mapStripeSubscriptionToUpsert } from './billingService';
import { reconcileUserTierFromBillingById } from './subscriptionEntitlementService';
import { isStripeBillingEnabled } from '../config/stripeBilling';

export interface ReconciliationSummary {
  processed: number;
  repaired: number;
  tierChanged: number;
  errors: number;
  orphaned: number;
}

const planKeyFromMetadata = (metadata: Record<string, string> | null): BillingPlanKey =>
  (metadata?.planKey as BillingPlanKey | undefined) ?? 'premium_monthly';

/**
 * Reconcile a single subscription by re-fetching it from Stripe and applying
 * the current state to local records and entitlements.
 *
 * Returns true when the local record was actually updated.
 */
export const reconcileSubscription = async (
  local: BillingSubscription,
  stripe: Stripe,
): Promise<{ repaired: boolean; tierChanged: boolean; orphaned: boolean }> => {
  let stripeSub: Stripe.Subscription;
  try {
    stripeSub = await stripe.subscriptions.retrieve(local.stripeSubscriptionId, {
      expand: ['latest_invoice'],
    });
  } catch (err) {
    const normalized = normalizeStripeError(err);
    if (normalized.statusCode === 404) {
      logInfo(`[billing][reconcile] Subscription not found in Stripe — marking orphaned sub=${local.stripeSubscriptionId} userId=${local.userId}`);
      incrementMetric('billing.reconcile.orphaned');
      return { repaired: false, tierChanged: false, orphaned: true };
    }
    logError('[billing][reconcile] Failed to retrieve subscription from Stripe', {
      stripeSubscriptionId: local.stripeSubscriptionId,
      kind: normalized.kind,
      message: normalized.message,
    });
    throw err;
  }

  const planKey = planKeyFromMetadata(stripeSub.metadata);
  const upsertParams = mapStripeSubscriptionToUpsert(stripeSub, local.userId, planKey);

  const before = await getBillingSubscriptionByStripeId(local.stripeSubscriptionId);
  await upsertBillingSubscription(upsertParams);
  const after = await getBillingSubscriptionByStripeId(local.stripeSubscriptionId);

  const statusChanged = before?.status !== after?.status;
  const repaired = statusChanged || before?.cancelAtPeriodEnd !== after?.cancelAtPeriodEnd;

  if (repaired) {
    incrementMetric('billing.reconcile.repaired');
    logInfo(`[billing][reconcile] Subscription repaired sub=${local.stripeSubscriptionId} userId=${local.userId} status=${before?.status}->${after?.status}`);
  }

  const reconcileResult = await reconcileUserTierFromBillingById(local.userId, {
    reason: 'Scheduled reconciliation',
    stripeSubscriptionId: local.stripeSubscriptionId,
  });

  return { repaired, tierChanged: reconcileResult.changed, orphaned: false };
};

/**
 * Run a reconciliation batch over subscriptions that haven't been synced
 * recently. Safe to call from a scheduled job or admin endpoint.
 *
 * @param olderThanMinutes  Only process records not synced within this window.
 * @param limit             Max subscriptions to process per run.
 */
export const runReconciliationBatch = async (
  olderThanMinutes = 60,
  limit = 100,
): Promise<ReconciliationSummary> => {
  if (!isStripeBillingEnabled()) {
    logInfo('[billing][reconcile] Billing disabled — skipping reconciliation batch');
    return { processed: 0, repaired: 0, tierChanged: 0, errors: 0, orphaned: 0 };
  }

  const summary: ReconciliationSummary = { processed: 0, repaired: 0, tierChanged: 0, errors: 0, orphaned: 0 };
  const stripe = getStripeClient();

  let stale: BillingSubscription[];
  try {
    stale = await listStaleSubscriptionsForReconciliation(olderThanMinutes, limit);
  } catch (err) {
    logError('[billing][reconcile] Failed to load stale subscriptions', { error: (err as Error)?.message });
    return summary;
  }

  logInfo(`[billing][reconcile] Starting batch count=${stale.length} olderThanMinutes=${olderThanMinutes} limit=${limit}`);

  for (const sub of stale) {
    summary.processed++;
    try {
      const { repaired, tierChanged, orphaned } = await reconcileSubscription(sub, stripe);
      if (repaired) summary.repaired++;
      if (tierChanged) summary.tierChanged++;
      if (orphaned) summary.orphaned++;
    } catch (err) {
      summary.errors++;
      logError('[billing][reconcile] Error reconciling subscription', {
        stripeSubscriptionId: sub.stripeSubscriptionId,
        userId: sub.userId,
        error: (err as Error)?.message,
      });
    }
  }

  incrementMetric('billing.reconcile.batch_processed', { count: summary.processed });
  logInfo(`[billing][reconcile] Batch complete processed=${summary.processed} repaired=${summary.repaired} tierChanged=${summary.tierChanged} errors=${summary.errors} orphaned=${summary.orphaned}`);

  await writeAuditLog({
    actorUserId: null,
    targetUserId: null,
    action: 'BILLING_RECONCILIATION_RUN',
    beforeState: null,
    afterState: { reconcileSummary: summary },
    reason: `Scheduled reconciliation batch: ${summary.repaired} repaired, ${summary.tierChanged} tier changes`,
  });

  return summary;
};

// ---------------------------------------------------------------------------
// In-process scheduler
// ---------------------------------------------------------------------------

const RECONCILE_INTERVAL_MS_DEFAULT = 24 * 60 * 60 * 1000; // 24 hours

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background reconciliation scheduler. Safe to call at startup —
 * no-ops in test environments and when billing is disabled. The interval can
 * be overridden with BILLING_RECONCILE_INTERVAL_MS (minimum 60 seconds).
 */
export const startBillingReconciliationScheduler = (): boolean => {
  if (schedulerHandle) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (!isStripeBillingEnabled()) {
    logInfo('[billing][reconcile] scheduler not started — billing is disabled');
    return false;
  }
  if (!getEnvFlag('BILLING_RECONCILE_ENABLED', { defaultValue: true })) {
    logInfo('[billing][reconcile] scheduler disabled by BILLING_RECONCILE_ENABLED=false');
    return false;
  }

  const rawInterval = getEnvValue('BILLING_RECONCILE_INTERVAL_MS');
  const intervalMs =
    rawInterval && Number.isFinite(Number(rawInterval))
      ? Math.max(60_000, Number(rawInterval))
      : RECONCILE_INTERVAL_MS_DEFAULT;

  logInfo(`[billing][reconcile] starting scheduler (interval=${intervalMs}ms)`);

  schedulerHandle = setInterval(() => {
    runReconciliationBatch().catch((err) =>
      logError('[billing][reconcile] scheduled batch error', err),
    );
  }, intervalMs);
  schedulerHandle.unref();
  return true;
};

export const stopBillingReconciliationScheduler = (): void => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
};
