/**
 * Opt-in Stripe test-mode integration tests.
 *
 * These tests call the real Stripe API using test-mode credentials. Two
 * categories are covered:
 *
 *  1. HTTP surface (status, plans, checkout URL, portal, refresh)
 *  2. Webhook event simulation — signs real event payloads with
 *     stripe.webhooks.generateTestHeaderString and delivers them to the
 *     webhook endpoint, then asserts DB state.
 *
 * Tests are skipped unless STRIPE_SANDBOX_TEST=1 is set.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY              = sk_test_<real test key>
 *   STRIPE_WEBHOOK_SECRET          = whsec_<real test webhook signing secret>
 *   STRIPE_PREMIUM_PRODUCT_ID
 *   STRIPE_PREMIUM_MONTHLY_PRICE_ID
 *   STRIPE_PREMIUM_ANNUAL_PRICE_ID
 *   STRIPE_CHECKOUT_SUCCESS_URL
 *   STRIPE_CHECKOUT_CANCEL_URL
 *   STRIPE_PORTAL_RETURN_URL
 *
 * Usage:
 *   STRIPE_SANDBOX_TEST=1 npx jest billing-stripe-sandbox --runInBand
 */

import Stripe from 'stripe';
import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  getBillingSubscriptionByStripeId,
  getCurrentUserTier,
  upsertBillingCustomer,
} from '../src/db';
import { STRIPE_API_VERSION } from '../src/config/stripeBilling';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

jest.setTimeout(60_000);

const SANDBOX_ENABLED = process.env.STRIPE_SANDBOX_TEST === '1';
const describeIfSandbox = SANDBOX_ENABLED ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Constructs a real Stripe client from the configured test-mode key. */
const makeStripe = () =>
  new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: STRIPE_API_VERSION });

/**
 * Wraps a Stripe object in a minimal Event envelope and delivers it to the
 * webhook route, signing with the real STRIPE_WEBHOOK_SECRET.
 */
const deliverWebhook = (
  stripe: Stripe,
  type: string,
  object: object,
  eventId?: string,
) => {
  const payload: object = {
    id: eventId ?? `evt_test_${type.replace(/\./g, '_')}_${Date.now()}`,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object },
    request: { id: null, idempotency_key: null },
  };
  const raw = JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return request(app)
    .post('/api/billing/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(Buffer.from(raw));
};

// ---------------------------------------------------------------------------
// Outer suite — validates env and bootstraps one shared user
// ---------------------------------------------------------------------------

const BASE_SUFFIX = `sandbox-${Date.now()}`;
const SANDBOX_EMAIL = `${BASE_SUFFIX}@example.com`;
const SANDBOX_PASSWORD = 'SandboxTest1!';

describeIfSandbox('Stripe sandbox — real test-mode API', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const required = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PREMIUM_PRODUCT_ID',
      'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
      'STRIPE_PREMIUM_ANNUAL_PRICE_ID',
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
      'STRIPE_PORTAL_RETURN_URL',
    ];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Sandbox test requires ${key} to be set`);
    }
    if (!process.env.STRIPE_SECRET_KEY!.startsWith('sk_test_')) {
      throw new Error('Sandbox tests must use a test-mode key (sk_test_...)');
    }

    process.env.STRIPE_BILLING_ENABLED = 'true';
    setStripeClientForTesting(null);

    await initDb();
    const user = await registerAndLoginWebUser({
      firstName: 'Sandbox',
      lastName: 'Test',
      email: SANDBOX_EMAIL,
      password: SANDBOX_PASSWORD,
    });
    token = user.token;
    userId = user.userId;
  });

  afterAll(async () => {
    delete process.env.STRIPE_BILLING_ENABLED;
    await cleanupTestUsersByEmail([SANDBOX_EMAIL, `${BASE_SUFFIX}-refund@example.com`]);
    await closePool();
  });

  // =========================================================================
  // HTTP surface tests
  // =========================================================================

  it('GET /api/billing/status returns a valid response', async () => {
    const res = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.effectiveTier).toBe('free');
    expect(res.body.checkoutAvailable).toBe(true);
    expect(res.body.portalAvailable).toBe(false);
  });

  it('GET /api/billing/plans returns configured plans with correct amounts', async () => {
    const res = await request(app)
      .get('/api/billing/plans')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const plans: any[] = res.body.plans;
    expect(Array.isArray(plans)).toBe(true);

    const monthly = plans.find((p) => p.planKey === 'premium_monthly');
    expect(monthly).toBeDefined();
    expect(monthly.amountCents).toBe(500);
    expect(monthly.currency).toBe('usd');
    expect(monthly.interval).toBe('month');
    expect(monthly.trialDays).toBe(14);

    const annual = plans.find((p) => p.planKey === 'premium_annual');
    expect(annual).toBeDefined();
    expect(annual.amountCents).toBe(3500);
    expect(annual.interval).toBe('year');
  });

  it('POST /api/billing/checkout-session creates a real Stripe Checkout URL', async () => {
    const idempotencyKey = `sandbox-monthly-${userId}-${Date.now()}`;
    const res = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' })
      .expect(201);

    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it('POST /api/billing/checkout-session is idempotent with the same key', async () => {
    const idempotencyKey = `sandbox-idempotent-${userId}-${Date.now()}`;

    const res1 = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' })
      .expect(201);

    const res2 = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' })
      .expect(201);

    expect(res1.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(res2.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it('POST /api/billing/checkout-session rejects non-web platform', async () => {
    await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey: 'native-test', clientPlatform: 'ios' })
      .expect(400);
  });

  it('POST /api/billing/portal-session returns 404 for user with no billing customer', async () => {
    const freshEmail = `${BASE_SUFFIX}-portal-fresh@example.com`;
    const freshUser = await registerAndLoginWebUser({
      firstName: 'Portal',
      lastName: 'Fresh',
      email: freshEmail,
      password: SANDBOX_PASSWORD,
    });
    try {
      await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${freshUser.token}`)
        .send({})
        .expect(404);
    } finally {
      await cleanupTestUsersByEmail([freshEmail]);
    }
  });

  it('POST /api/billing/refresh reconciles billing state', async () => {
    const res = await request(app)
      .post('/api/billing/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.status).toBeDefined();
    expect(res.body.status.effectiveTier).toBe('free');
  });

  // =========================================================================
  // Webhook simulation — subscription lifecycle
  //
  // Uses a trial subscription so no payment card is needed. Events are
  // constructed with the real Stripe subscription ID and signed with
  // generateTestHeaderString. The handler calls stripe.subscriptions.retrieve
  // to get live state, so the subscription must exist in Stripe.
  // =========================================================================

  describe('webhook simulation — subscription lifecycle', () => {
    const stripe = makeStripe();
    let stripeCustomerId: string;
    let sub: Stripe.Subscription;
    let seq = 0;
    const nextId = (tag: string) => `evt_test_${tag}_${Date.now()}_${++seq}`;

    beforeAll(async () => {
      // Create a Stripe customer with our local userId in metadata so that
      // userIdFromSubscription can resolve it without a billing_customers row.
      const customer = await stripe.customers.create({
        email: SANDBOX_EMAIL,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;

      // Persist billing_customer so portal and other routes work.
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: customer.id,
        emailSnapshot: SANDBOX_EMAIL,
        livemode: false,
      });

      // Create a trial subscription — no immediate charge.
      sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID! }],
        trial_period_days: 14,
        metadata: { userId, planKey: 'premium_monthly' },
      });
    });

    afterAll(async () => {
      if (sub?.id) {
        await stripe.subscriptions.cancel(sub.id).catch(() => undefined);
      }
    });

    it('customer.subscription.created → subscription synced to DB and tier = premium', async () => {
      // Fetch the live subscription — the handler will do the same via retrieve.
      const freshSub = await stripe.subscriptions.retrieve(sub.id);

      const res = await deliverWebhook(stripe, 'customer.subscription.created', freshSub, nextId('sub_created'));
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.duplicate).toBeFalsy();

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      expect(stored).toBeDefined();
      expect(stored!.stripeSubscriptionId).toBe(sub.id);
      expect(stored!.status).toBe('trialing');
      expect(stored!.userId).toBe(userId);
      expect(stored!.planKey).toBe('premium_monthly');

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('customer.subscription.updated (cancel_at_period_end=true) → DB reflects scheduled cancellation, user still premium', async () => {
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });

      await deliverWebhook(stripe, 'customer.subscription.updated', updated, nextId('sub_updated'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      expect(stored!.cancelAtPeriodEnd).toBe(true);

      // Trialing + cancel_at_period_end does not revoke access immediately.
      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('invoice.payment_failed → pastDueSince recorded in DB', async () => {
      // Synthetic invoice — only invoice.subscription is read by the handler.
      // The handler then calls stripe.subscriptions.retrieve(sub.id), which works
      // because the real subscription exists.
      const syntheticInvoice = {
        id: `in_fake_failed_${Date.now()}`,
        object: 'invoice',
        subscription: sub.id,
        status: 'open',
      };

      await deliverWebhook(stripe, 'invoice.payment_failed', syntheticInvoice, nextId('inv_failed'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      expect(stored!.pastDueSince).toBeTruthy();
    });

    it('invoice.paid → pastDueSince cleared, tier remains premium', async () => {
      const syntheticInvoice = {
        id: `in_fake_paid_${Date.now()}`,
        object: 'invoice',
        subscription: sub.id,
        status: 'paid',
      };

      await deliverWebhook(stripe, 'invoice.paid', syntheticInvoice, nextId('inv_paid'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      expect(stored!.pastDueSince).toBeNull();

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('duplicate event delivery → second POST returns duplicate=true, DB unchanged', async () => {
      const sharedEventId = `evt_dupe_${Date.now()}`;
      const freshSub = await stripe.subscriptions.retrieve(sub.id);

      const r1 = await deliverWebhook(stripe, 'customer.subscription.updated', freshSub, sharedEventId);
      expect(r1.status).toBe(200);
      expect(r1.body.duplicate).toBeFalsy();

      // Re-deliver the exact same signed event.
      const r2 = await deliverWebhook(stripe, 'customer.subscription.updated', freshSub, sharedEventId);
      expect(r2.status).toBe(200);
      expect(r2.body.duplicate).toBe(true);
    });

    it('customer.subscription.deleted → status=canceled in DB and tier = free', async () => {
      const canceled = await stripe.subscriptions.cancel(sub.id);
      expect(canceled.status).toBe('canceled');

      await deliverWebhook(stripe, 'customer.subscription.deleted', canceled, nextId('sub_deleted'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      expect(stored!.status).toBe('canceled');

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('free');
    });
  });

  // =========================================================================
  // Webhook simulation — full refund revocation
  //
  // Creates a separate subscription WITHOUT a trial so an invoice is
  // generated and charged immediately. The charge is then refunded via the
  // Stripe API and a charge.refunded event is delivered to the webhook.
  // =========================================================================

  describe('webhook simulation — full refund revocation', () => {
    const stripe = makeStripe();
    const REFUND_EMAIL = `${BASE_SUFFIX}-refund@example.com`;

    let refundUserId: string;
    let refundToken: string;
    let refundSub: Stripe.Subscription;
    let chargeId: string;
    let seq = 0;
    const nextId = (tag: string) => `evt_test_${tag}_${Date.now()}_${++seq}`;

    beforeAll(async () => {
      // Create a separate local user so tier changes don't interfere with
      // the lifecycle suite's user.
      const refundUser = await registerAndLoginWebUser({
        firstName: 'Refund',
        lastName: 'Test',
        email: REFUND_EMAIL,
        password: SANDBOX_PASSWORD,
      });
      refundUserId = refundUser.userId;
      refundToken = refundUser.token;

      // Create Stripe customer with metadata so userIdFromSubscription resolves.
      const customer = await stripe.customers.create({
        email: REFUND_EMAIL,
        metadata: { userId: refundUserId },
      });

      await upsertBillingCustomer({
        userId: refundUserId,
        stripeCustomerId: customer.id,
        emailSnapshot: REFUND_EMAIL,
        livemode: false,
      });

      // Attach a test payment method so the subscription invoice is charged.
      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: '4242424242424242',
          exp_month: 12,
          exp_year: 2030,
          cvc: '123',
        },
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      await stripe.customers.update(customer.id, {
        invoice_settings: { default_payment_method: pm.id },
      });

      // Create subscription without trial — invoice is immediately paid.
      refundSub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID! }],
        metadata: { userId: refundUserId, planKey: 'premium_monthly' },
        expand: ['latest_invoice.charge'],
      });

      // Extract charge ID from the expanded invoice.
      const latestInvoice = refundSub.latest_invoice as Stripe.Invoice & {
        charge?: Stripe.Charge | string | null;
      };
      if (!latestInvoice || typeof latestInvoice === 'string') {
        throw new Error('Subscription latest_invoice was not expanded — test setup failed');
      }
      const charge = latestInvoice.charge;
      chargeId = typeof charge === 'string' ? charge : (charge?.id ?? '');
      if (!chargeId) {
        throw new Error(
          'No charge found on the subscription invoice. ' +
          'The invoice may not have been immediately collected. Test setup failed.',
        );
      }
    });

    afterAll(async () => {
      if (refundSub?.id) {
        await stripe.subscriptions.cancel(refundSub.id).catch(() => undefined);
      }
    });

    it('initial subscription synced to DB and user tier = premium', async () => {
      const freshSub = await stripe.subscriptions.retrieve(refundSub.id);

      await deliverWebhook(stripe, 'customer.subscription.created', freshSub, nextId('sub_created'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('active');
      expect(stored!.userId).toBe(refundUserId);

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('partial refund → no entitlement change, tier stays premium', async () => {
      // Create a partial refund (half of the charge amount).
      const chargeObj = await stripe.charges.retrieve(chargeId);
      const partialAmount = Math.floor(chargeObj.amount / 2);
      await stripe.refunds.create({ charge: chargeId, amount: partialAmount });

      const partiallyRefundedCharge = await stripe.charges.retrieve(chargeId);
      expect(partiallyRefundedCharge.amount_refunded).toBe(partialAmount);
      expect(partiallyRefundedCharge.refunded).toBe(false);

      await deliverWebhook(stripe, 'charge.refunded', partiallyRefundedCharge, nextId('partial_refund'))
        .expect(200);

      // Entitlement should be unchanged — partial refund does not revoke access.
      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      expect(stored!.accessRevokedAt).toBeNull();

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('full refund → accessRevokedAt set, tier = free', async () => {
      // Refund the remaining amount to make it a full refund.
      const chargeObj = await stripe.charges.retrieve(chargeId);
      const remaining = chargeObj.amount - chargeObj.amount_refunded;
      await stripe.refunds.create({ charge: chargeId, amount: remaining });

      const fullyRefundedCharge = await stripe.charges.retrieve(chargeId);
      expect(fullyRefundedCharge.refunded).toBe(true);
      expect(fullyRefundedCharge.amount_refunded).toBe(fullyRefundedCharge.amount);

      await deliverWebhook(stripe, 'charge.refunded', fullyRefundedCharge, nextId('full_refund'))
        .expect(200);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      expect(stored!.accessRevokedAt).toBeTruthy();
      expect(stored!.accessRevocationReason).toBe('full_refund');
      expect(stored!.refundedAt).toBeTruthy();

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('free');
    });

    it('billing status endpoint reflects revoked access after full refund', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${refundToken}`)
        .expect(200);

      expect(res.body.effectiveTier).toBe('free');
    });
  });
});
