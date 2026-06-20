import {
  getBillingCustomerByUserId,
  listActiveBillingSubscriptionsForUser,
} from '../db';
import { getStripeClient, normalizeStripeError } from './stripeClient';
import { isStripeBillingEnabled } from '../config/stripeBilling';
import { logInfo, logError } from '../logger';
import { incrementMetric } from '../metrics';

/**
 * Cancel all active Stripe subscriptions for a user immediately.
 * Called before account deletion so the user is not silently charged after deletion.
 *
 * Failures are logged but do not throw — the caller (account deletion)
 * should continue with the local deletion even if Stripe cancellation fails,
 * since Stripe retains the subscription record and operators can cancel manually.
 */
export const cancelAllSubscriptionsForUser = async (userId: string): Promise<void> => {
  if (!isStripeBillingEnabled()) return;

  let subscriptions;
  try {
    subscriptions = await listActiveBillingSubscriptionsForUser(userId);
  } catch (err) {
    logError('[billing][lifecycle] Failed to list subscriptions during account deletion', {
      userId,
      error: (err as Error)?.message,
    });
    return;
  }

  if (subscriptions.length === 0) return;

  const stripe = getStripeClient();
  for (const sub of subscriptions) {
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue;
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      incrementMetric('billing.lifecycle.subscription_cancelled_on_deletion');
      logInfo(`[billing][lifecycle] Subscription cancelled during account deletion userId=${userId} sub=${sub.stripeSubscriptionId}`);
    } catch (err) {
      const normalized = normalizeStripeError(err);
      logError('[billing][lifecycle] Failed to cancel Stripe subscription during account deletion', {
        userId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        kind: normalized.kind,
        message: normalized.message,
      });
      incrementMetric('billing.lifecycle.cancel_on_deletion_failed');
    }
  }
};

/**
 * Synchronize an updated email address to the user's Stripe Customer record.
 * Called after a verified primary email change.
 *
 * Failures are non-fatal — Stripe Customer email is informational and the
 * durable subscription identity is the local userId metadata, not the email.
 */
export const syncEmailToStripeCustomer = async (
  userId: string,
  newEmail: string,
): Promise<void> => {
  if (!isStripeBillingEnabled()) return;

  let customer;
  try {
    customer = await getBillingCustomerByUserId(userId);
  } catch {
    return;
  }
  if (!customer) return;

  try {
    const stripe = getStripeClient();
    await stripe.customers.update(customer.stripeCustomerId, { email: newEmail });
    logInfo(`[billing][lifecycle] Stripe Customer email updated userId=${userId}`);
  } catch (err) {
    const normalized = normalizeStripeError(err);
    logError('[billing][lifecycle] Failed to sync email to Stripe Customer', {
      userId,
      kind: normalized.kind,
      message: normalized.message,
    });
  }
};
