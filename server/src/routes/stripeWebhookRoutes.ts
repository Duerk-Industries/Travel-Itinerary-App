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
  const metaUserId = sub.metadata?.userId;
  if (metaUserId) return metaUserId;

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

  const existing = await getBillingSubscriptionByStripeId(subscriptionId);
  if (existing && !existing.pastDueSince) {
    await setPastDueSince(subscriptionId, new Date());
    incrementMetric('billing.webhook.past_due_clock_started');
  }

  await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
};

/**
 * Handles invoice.payment_action_required (SCA/3DS challenge required).
 * We snapshot the subscription state but do NOT start the past-due clock —
 * the customer still has a chance to authenticate and complete the payment.
 * If they succeed, invoice.paid fires and clears past_due_since.
 * If they don't, Stripe will eventually emit invoice.payment_failed.
 */
const handleInvoicePaymentActionRequired = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;

  await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
};

/** Resolve an invoice ID → subscription ID, retrieving the invoice if needed. */
const subscriptionIdFromInvoiceId = async (
  stripe: Stripe,
  invoiceId: string,
): Promise<string | null> => {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const sub = invoice.subscription;
  return typeof sub === 'string' ? sub : (sub?.id ?? null);
};

const handleChargeRefunded = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const charge = event.data.object as Stripe.Charge;
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) return;

  const refundedAmount = charge.amount_refunded ?? 0;
  const chargeAmount = charge.amount ?? 0;
  const isFull = chargeAmount > 0 && refundedAmount >= chargeAmount;

  if (!isFull) {
    logInfo(`[billing][webhook] Partial refund recorded — no automatic entitlement change chargeId=${charge.id} invoiceId=${invoiceId} refunded=${refundedAmount}/${chargeAmount}`);
    incrementMetric('billing.webhook.partial_refund');
    return;
  }

  incrementMetric('billing.webhook.full_refund_received');
  logInfo(`[billing][webhook] Full refund on charge, revoking Premium access chargeId=${charge.id} invoiceId=${invoiceId}`);

  let subscriptionId: string | null = null;
  try {
    subscriptionId = await subscriptionIdFromInvoiceId(stripe, invoiceId);
  } catch (err) {
    logError('[billing][webhook] Failed to retrieve invoice for full-refund revocation', err);
    return;
  }

  if (!subscriptionId) {
    logInfo(`[billing][webhook] Full-refund charge has no linked subscription — no revocation chargeId=${charge.id}`);
    return;
  }

  // Ensure subscription is in the local DB; sync snapshot if missing.
  let local = await getBillingSubscriptionByStripeId(subscriptionId);
  if (!local) {
    await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
    local = await getBillingSubscriptionByStripeId(subscriptionId);
  }
  if (!local) {
    logError(`[billing][webhook] Subscription not found after sync — cannot revoke access`, {
      subscriptionId,
      chargeId: charge.id,
    });
    return;
  }

  await revokeBillingSubscriptionAccess(subscriptionId, 'full_refund', {
    refundedAt: new Date(event.created * 1000),
  });
  await reconcileUserTierFromBillingById(local.userId, {
    reason: 'Full refund — Premium access revoked',
    stripeSubscriptionId: subscriptionId,
    stripeEventId: event.id,
  });
  incrementMetric('billing.webhook.full_refund_access_revoked');
};

/** Shared helper: resolve dispute → charge → invoice → subscription chain. */
const subscriptionIdFromDisputeCharge = async (
  stripe: Stripe,
  chargeId: string,
): Promise<string | null> => {
  const charge = await stripe.charges.retrieve(chargeId);
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) return null;
  return subscriptionIdFromInvoiceId(stripe, invoiceId);
};

const handleDisputeCreated = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;

  logInfo(`[billing][webhook] Dispute created — revoking Premium access disputeId=${dispute.id} chargeId=${chargeId}`);
  incrementMetric('billing.webhook.dispute_created');

  if (!chargeId) return;

  let subscriptionId: string | null = null;
  try {
    subscriptionId = await subscriptionIdFromDisputeCharge(stripe, chargeId);
  } catch (err) {
    logError('[billing][webhook] Failed to resolve subscription for dispute revocation', err);
    return;
  }

  if (!subscriptionId) {
    logInfo(`[billing][webhook] Dispute has no linked subscription — no revocation disputeId=${dispute.id}`);
    return;
  }

  let local = await getBillingSubscriptionByStripeId(subscriptionId);
  if (!local) {
    await handleSubscriptionSnapshot(stripe, subscriptionId, event.created, event.id);
    local = await getBillingSubscriptionByStripeId(subscriptionId);
  }
  if (!local) return;

  await revokeBillingSubscriptionAccess(subscriptionId, 'dispute', { disputeId: dispute.id });
  await reconcileUserTierFromBillingById(local.userId, {
    reason: 'Dispute opened — Premium access revoked',
    stripeSubscriptionId: subscriptionId,
    stripeEventId: event.id,
  });
  incrementMetric('billing.webhook.dispute_access_revoked');
};

const handleDisputeClosed = async (
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> => {
  const dispute = event.data.object as Stripe.Dispute;
  logInfo(`[billing][webhook] Dispute closed disputeId=${dispute.id} status=${dispute.status}`);
  incrementMetric('billing.webhook.dispute_closed');

  // Only 'won' status restores access; lost/warning_closed keeps the revocation.
  if (dispute.status !== 'won') return;

  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  let subscriptionId: string | null = null;
  try {
    subscriptionId = await subscriptionIdFromDisputeCharge(stripe, chargeId);
  } catch (err) {
    logError('[billing][webhook] Failed to resolve subscription for dispute restoration', err);
    return;
  }

  if (!subscriptionId) return;

  const local = await getBillingSubscriptionByStripeId(subscriptionId);
  if (!local) return;

  await restoreBillingSubscriptionAccess(subscriptionId);
  await reconcileUserTierFromBillingById(local.userId, {
    reason: 'Dispute won — Premium access restored',
    stripeSubscriptionId: subscriptionId,
    stripeEventId: event.id,
  });
  incrementMetric('billing.webhook.dispute_won_access_restored');
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

type EventHandler = (stripe: Stripe, event: Stripe.Event) => Promise<void>;

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
  'invoice.payment_action_required': handleInvoicePaymentActionRequired,
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
    logError('[billing][webhook] Signature verification failed', err);
    incrementMetric('billing.webhook.signature_failed');
    res.status(400).json({ error: 'Webhook signature verification failed.' });
    return;
  }

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
    logError('[billing][webhook] Handler failed', err);
    await markStripeWebhookEventFailed(event.id, message);
    incrementMetric('billing.webhook.handler_failed', { eventType: event.type });
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

export default router;
