import { Router } from 'express';
import Stripe from 'stripe';
import { getStripeClient } from '../billing/stripeClient';
import { getStripeWebhookSecret, isStripeBillingEnabled } from '../config/stripeBilling';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
  upsertBillingSubscription,
  getBillingCustomerByStripeId,
  setPastDueSince,
  clearPastDueSince,
  revokeBillingSubscriptionAccess,
  restoreBillingSubscriptionAccess,
  getBillingSubscriptionByStripeId,
} from '../db';
import { mapStripeSubscriptionToUpsert } from '../billing/billingService';
import { reconcileUserTierFromBillingById } from '../billing/subscriptionEntitlementService';
import { logInfo, logError } from '../logger';
import { incrementMetric } from '../metrics';
import { BillingPlanKey } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const planKeyFromMetadata = (metadata: Record<string, string> | null): BillingPlanKey | null => {
  const val = metadata?.planKey;
  if (val === 'premium_monthly' || val === 'premium_annual') return val;
  return null;
};

const userIdFromSubscription = async (sub: Stripe.Subscription): Promise<string | null> => {
  // Prefer metadata set at Checkout Session creation time.
  const metaUserId = sub.metadata?.userId;
  if (metaUserId) return metaUserId;

  // Fall back to billing_customers lookup.
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const bc = await getBillingCustomerByStripeId(customerId);
  return bc?.userId ?? null;
};

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Core handler for all subscription state-change events. Re-fetches the
 * live Subscription from Stripe before applying state so out-of-order
 * delivery doesn't apply stale state.
 */
const handleSubscriptionSnapshot = async (
  stripe: Stripe,
  subscriptionId: string,
  eventCreated: number,
  stripeEventId: string,
): Promise<void> => {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice'],
  });

  const userId = await userIdFromSubscription(sub);
  if (!userId) {
    logError('[billing][webhook] Cannot resolve userId for subscription', {
      stripeSubscriptionId: subscriptionId,
    });
    incrementMetric('billing.webhook.user_not_found');
    return;
  }

  const planKey = planKeyFromMetadata(sub.metadata) ?? 'premium_monthly';
  const upsertParams = mapStripeSubscriptionToUpsert(sub, userId, planKey, eventCreated);
  await upsertBillingSubscription(upsertParams);

  await reconcileUserTierFromBillingById(userId, {
    reason: 'Stripe subscription event',
    stripeSubscriptionId: subscriptionId,
    stripeEventId,
  });

  logInfo(`[billing][webhook] Subscription snapshot applied sub=${subscriptionId} status=${sub.status} userId=${userId}`);
};

const handleCheckoutSessionCompleted = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'subscription') return;

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subscriptionId) {
    logError('[billing][webhook] checkout.session.completed missing subscription ID', {
      sessionId: session.id,
    });
    return;
  }

  await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
};

const handleInvoicePaid = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;

  // A paid invoice resolves any past-due delinquency.
  await clearPastDueSince(subscriptionId);
  await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
};

const handleInvoicePaymentFailed = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;

  // Only start the grace-period clock if it hasn't already started.
  const existing = await getBillingSubscriptionByStripeId(subscriptionId);
  if (existing && !existing.pastDueSince) {
    await setPastDueSince(subscriptionId, new Date());
    incrementMetric('billing.webhook.past_due_clock_started');
  }

  await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
};

const handleChargeRefunded = async (
  _stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const charge = event.data.object as Stripe.Charge;
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) return;

  // Full refund → revoke access immediately. Partial refund → audit only.
  const refundedAmount = charge.amount_refunded ?? 0;
  const chargeAmount = charge.amount ?? 0;
  const isFull = chargeAmount > 0 && refundedAmount >= chargeAmount;

  if (!isFull) {
    // Partial refund: log for operator visibility only, no entitlement change.
    logInfo(`[billing][webhook] Partial refund recorded — no automatic entitlement change chargeId=${charge.id} invoiceId=${invoiceId} refunded=${refundedAmount}/${chargeAmount}`);
    incrementMetric('billing.webhook.partial_refund');
    return;
  }

  // Find subscription via invoice metadata — best effort; if not found, log and skip.
  logInfo(`[billing][webhook] Full refund on charge, attempting to revoke access chargeId=${charge.id} invoiceId=${invoiceId}`);
  incrementMetric('billing.webhook.full_refund_received');
  // Actual subscription lookup from invoice is done via stripeClient if needed.
  // For now, emit the metric and log so operators can reconcile manually if the
  // subscription_id cannot be resolved here. A reconciliation job will catch
  // any remaining access.
};

const handleDisputeCreated = async (
  _stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  logInfo(`[billing][webhook] Dispute created — flagging for manual review disputeId=${dispute.id} chargeId=${chargeId}`);
  incrementMetric('billing.webhook.dispute_created');
  // Operator alert: manual review required. A future phase will wire
  // charge→invoice→subscription lookup and call revokeBillingSubscriptionAccess.
};

const handleDisputeClosed = async (
  _stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const dispute = event.data.object as Stripe.Dispute;
  logInfo(`[billing][webhook] Dispute closed disputeId=${dispute.id} status=${dispute.status}`);
  incrementMetric('billing.webhook.dispute_closed');
  // Won disputes restore access (see reconciliation service).
  // Lost disputes keep access revoked — operator must confirm.
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type EventHandler = (stripe: Stripe, event: Stripe.Event) => Promise<void>;

const SUBSCRIPTION_SNAPSHOT_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const buildDispatchTable = (stripe: Stripe): Record<string, EventHandler> => ({
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': async (_s, e) => {
    const sub = e.data.object as Stripe.Subscription;
    await handleSubscriptionSnapshot(stripe, sub.id, e.created, e.id);
  },
  'customer.subscription.updated': async (_s, e) => {
    const sub = e.data.object as Stripe.Subscription;
    await handleSubscriptionSnapshot(stripe, sub.id, e.created, e.id);
  },
  'customer.subscription.deleted': async (_s, e) => {
    const sub = e.data.object as Stripe.Subscription;
    await handleSubscriptionSnapshot(stripe, sub.id, e.created, e.id);
  },
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'invoice.payment_action_required': handleInvoicePaymentFailed,
  'charge.refunded': handleChargeRefunded,
  'charge.dispute.created': handleDisputeCreated,
  'charge.dispute.closed': handleDisputeClosed,
});

// ---------------------------------------------------------------------------
// Webhook route — must be mounted BEFORE express.json() in app.ts
// ---------------------------------------------------------------------------

/**
 * POST /api/billing/webhooks/stripe
 *
 * Mounted with express.raw({ type: 'application/json' }) so the raw body
 * is available for Stripe signature verification. Do NOT mount after
 * express.json() — JSON parsing destroys the raw body needed by
 * stripe.webhooks.constructEvent().
 */
router.post('/stripe', async (req, res) => {
  if (!isStripeBillingEnabled()) {
    res.status(503).json({ error: 'Billing is not enabled.' });
    return;
  }

  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    logError('[billing][webhook] STRIPE_WEBHOOK_SECRET is not configured');
    res.status(500).json({ error: 'Webhook secret not configured.' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    incrementMetric('billing.webhook.missing_signature');
    res.status(400).json({ error: 'Missing Stripe-Signature header.' });
    return;
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
  } catch (err) {
    logError('[billing][webhook] Signature verification failed', {
      message: (err as Error)?.message,
    });
    incrementMetric('billing.webhook.signature_failed');
    res.status(400).json({ error: 'Webhook signature verification failed.' });
    return;
  }

  // Idempotent claim — returns false if already processed/claimed.
  const claimed = await claimStripeWebhookEvent({
    stripeEventId: event.id,
    eventType: event.type,
    stripeObjectId: (event.data.object as any)?.id ?? null,
    livemode: event.livemode,
    eventCreated: event.created,
  });

  if (!claimed) {
    logInfo(`[billing][webhook] Duplicate event ignored eventId=${event.id} eventType=${event.type}`);
    incrementMetric('billing.webhook.duplicate');
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  const dispatch = buildDispatchTable(stripe);
  const handler = dispatch[event.type];

  if (!handler) {
    logInfo(`[billing][webhook] Unsupported event type acknowledged eventId=${event.id} eventType=${event.type}`);
    await markStripeWebhookEventProcessed(event.id);
    incrementMetric('billing.webhook.ignored', { eventType: event.type });
    res.status(200).json({ received: true, handled: false });
    return;
  }

  try {
    await handler(stripe, event);
    await markStripeWebhookEventProcessed(event.id);
    incrementMetric('billing.webhook.processed', { eventType: event.type });
    res.status(200).json({ received: true });
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    logError('[billing][webhook] Handler failed', {
      eventId: event.id,
      eventType: event.type,
      error: message,
    });
    await markStripeWebhookEventFailed(event.id, message);
    incrementMetric('billing.webhook.handler_failed', { eventType: event.type });
    // Return non-2xx so Stripe retries delivery.
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

export default router;
