/// <reference types="jest" />
/// <reference types="node" />
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
 *   STRIPE_CHECKOUT_SUCCESS_URL
 *   STRIPE_CHECKOUT_CANCEL_URL
 *   STRIPE_PORTAL_RETURN_URL
 *
 * Price IDs (at least one source required per plan):
 *   STRIPE_PREMIUM_MONTHLY_PRICE_ID  — or a price published via Admin → Billing
 *   STRIPE_PREMIUM_ANNUAL_PRICE_ID   — or a price published via Admin → Billing
 *
 * Usage:
 *   STRIPE_SANDBOX_TEST=1 npx jest billing-stripe-sandbox --runInBand
 *
 * Scenarios covered:
 *   HTTP: unauthenticated → 401 (status, plans, checkout, portal),
 *         billing disabled → 503 (webhook + plans),
 *         status (free user), plans (amounts/intervals),
 *         checkout (monthly create, annual create, idempotent same-URL, native-rejected 400,
 *           unknown planKey 400, already-subscribed 409),
 *         portal (no-customer 404, happy path), refresh,
 *         status (trialing: plan/isBillingManaged/currentPeriodEnd/inGracePeriod/accessRevoked,
 *           cancelAtPeriodEnd, free + portalAvailable=false after deletion)
 *   Webhooks: billing disabled → 503, invalid/missing signature → 400, unknown event → 200 handled=false,
 *             checkout.session.completed with mode=payment (ignored, no subscription processing),
 *             customer.subscription.created/updated/deleted,
 *             checkout.session.completed (subscription mode),
 *             invoice.payment_action_required (no past-due clock),
 *             invoice.payment_failed (first sets pastDueSince, second is idempotent), invoice.paid,
 *             duplicate event idempotency,
 *             charge.refunded (partial and full), refund.updated, refund.failed,
 *             charge.dispute.created, charge.dispute.closed (lost preserves reason, won restores)
 */

import Stripe from 'stripe';
import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  findUserByEmail,
  getBillingPlanConfig,
  getBillingSubscriptionByStripeId,
  getCurrentUserTier,
  upsertBillingCustomer,
  upsertBillingPlanConfig,
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
 * Resolves (or creates) a real test-mode Stripe Price for the given plan.
 * Checks env var first, then DB, then creates one automatically if neither
 * exists and STRIPE_PREMIUM_PRODUCT_ID is set.
 */
const resolveSandboxPriceId = async (
  stripe: Stripe,
  planKey: 'premium_monthly' | 'premium_annual',
  envVar: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID' | 'STRIPE_PREMIUM_ANNUAL_PRICE_ID',
  expected: { amountCents: number; interval: 'month' | 'year' },
): Promise<string> => {
  const dbPriceId = (await getBillingPlanConfig(planKey))?.activeStripePriceId ?? undefined;
  const candidates = Array.from(new Set([process.env[envVar], dbPriceId].filter(Boolean))) as string[];
  const errors: string[] = [];

  for (const priceId of candidates) {
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (price.livemode) throw new Error('live-mode Price — sandbox tests require test-mode Prices');
      if (!price.active) throw new Error('Price is not active');
      if (
        price.unit_amount !== expected.amountCents ||
        price.currency !== 'usd' ||
        price.recurring?.interval !== expected.interval
      ) {
        throw new Error(
          `Amount/interval mismatch: expected ${expected.amountCents} usd/${expected.interval}, ` +
          `got ${price.unit_amount} ${price.currency}/${price.recurring?.interval ?? 'none'}`,
        );
      }
      return price.id;
    } catch (err) {
      errors.push(`${priceId}: ${(err as Error).message}`);
    }
  }

  const productId = process.env.STRIPE_PREMIUM_PRODUCT_ID;
  if (!productId) {
    throw new Error(
      `Sandbox test requires STRIPE_PREMIUM_PRODUCT_ID to auto-create a missing test Price for ${planKey}. ` +
      `Rejected candidates: ${errors.join('; ') || 'none'}. ` +
      `Set ${envVar} or publish a price via Admin → Billing.`,
    );
  }

  const created = await stripe.prices.create({
    product: productId,
    unit_amount: expected.amountCents,
    currency: 'usd',
    recurring: { interval: expected.interval },
    tax_behavior: 'exclusive',
    metadata: { planKey, createdBy: 'billing-stripe-sandbox.test' },
  });
  if (created.livemode) {
    throw new Error(`Refusing to use live-mode Price ${created.id} in sandbox tests`);
  }
  return created.id;
};

/**
 * Attaches a tok_visa payment method to a Stripe customer and sets it as the
 * default. Uses Stripe's built-in test token instead of raw card numbers (raw
 * card data requires a special Stripe account permission).
 */
const attachTestCard = async (stripe: Stripe, customerId: string): Promise<void> => {
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
};

/**
 * Creates a subscription without a trial (immediately charged) and returns both
 * the subscription and the charge ID for that first invoice.
 *
 * Uses the dahlia Invoice path: Invoice.charge was removed; charges now live in
 * InvoicePayment → PaymentIntent → latest_charge.
 */
const createPaidSubscription = async (
  stripe: Stripe,
  customerId: string,
  priceId: string,
  metadata: Record<string, string>,
): Promise<{ sub: Stripe.Subscription; chargeId: string }> => {
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata,
    expand: ['latest_invoice'],
  });

  const invoiceId =
    typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id ?? null;
  if (!invoiceId) {
    throw new Error(
      `createPaidSubscription: latest_invoice not found on subscription ${sub.id}. ` +
      `The subscription may not have been charged immediately.`,
    );
  }

  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 1 });
  const firstPayment = payments.data[0];
  if (!firstPayment) {
    throw new Error(
      `createPaidSubscription: no InvoicePayment found for invoice ${invoiceId} ` +
      `(subscription ${sub.id}). The invoice may not have been immediately collected.`,
    );
  }

  let chargeId = '';
  const piRef = firstPayment.payment.payment_intent;
  const piId = typeof piRef === 'string' ? piRef : piRef?.id ?? '';
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? '';
  } else {
    // Rare: direct charge reference on pre-PI invoices.
    const chargeRef = firstPayment.payment.charge;
    chargeId = typeof chargeRef === 'string' ? chargeRef : chargeRef?.id ?? '';
  }

  if (!chargeId) {
    throw new Error(
      `createPaidSubscription: could not extract charge ID from invoice ${invoiceId} ` +
      `(subscription ${sub.id}). PaymentIntent ID was: ${piId || 'not found'}.`,
    );
  }

  return { sub, chargeId };
};

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
    .send(raw);
};

/**
 * Throws if the HTTP response status is not `expected`, including the full
 * response body in the error message for fast debugging.
 */
const expectStatus = (res: request.Response, expected: number): void => {
  if (res.status !== expected) {
    throw new Error(
      `Expected HTTP ${expected}, got ${res.status}.\nResponse body: ${JSON.stringify(res.body, null, 2)}`,
    );
  }
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
  let sandboxMonthlyPriceId: string;
  let sandboxAnnualPriceId: string;

  beforeAll(async () => {
    const alwaysRequired = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PREMIUM_PRODUCT_ID',
      'STRIPE_CHECKOUT_SUCCESS_URL',
      'STRIPE_CHECKOUT_CANCEL_URL',
      'STRIPE_PORTAL_RETURN_URL',
    ];
    for (const key of alwaysRequired) {
      if (!process.env[key]) throw new Error(`Sandbox test requires ${key} to be set`);
    }
    if (!process.env.STRIPE_SECRET_KEY!.startsWith('sk_test_')) {
      throw new Error('Sandbox tests must use a test-mode key (sk_test_...)');
    }

    process.env.STRIPE_BILLING_ENABLED = 'true';
    // Override URLs to stable non-localhost values so Stripe accepts them.
    process.env.STRIPE_CHECKOUT_SUCCESS_URL =
      'https://example.com/stripe-sandbox/success?session_id={CHECKOUT_SESSION_ID}';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://example.com/stripe-sandbox/cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'https://example.com/stripe-sandbox/account';
    setStripeClientForTesting(null);

    await initDb();
    const stripe = makeStripe();
    sandboxMonthlyPriceId = await resolveSandboxPriceId(
      stripe,
      'premium_monthly',
      'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
      { amountCents: 500, interval: 'month' },
    );
    sandboxAnnualPriceId = await resolveSandboxPriceId(
      stripe,
      'premium_annual',
      'STRIPE_PREMIUM_ANNUAL_PRICE_ID',
      { amountCents: 3500, interval: 'year' },
    );
    process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = sandboxMonthlyPriceId;
    process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID = sandboxAnnualPriceId;
    await upsertBillingPlanConfig({
      planKey: 'premium_monthly',
      activeStripePriceId: sandboxMonthlyPriceId,
      unitAmountCents: 500,
      currency: 'usd',
      interval: 'month',
      trialDays: 14,
      pastDueGraceDays: 30,
      automaticTaxEnabled: false,
      promotionCodesEnabled: true,
      isCheckoutEnabled: true,
      livemode: false,
      updatedBy: null,
    });
    await upsertBillingPlanConfig({
      planKey: 'premium_annual',
      activeStripePriceId: sandboxAnnualPriceId,
      unitAmountCents: 3500,
      currency: 'usd',
      interval: 'year',
      trialDays: 14,
      pastDueGraceDays: 30,
      automaticTaxEnabled: false,
      promotionCodesEnabled: true,
      isCheckoutEnabled: true,
      livemode: false,
      updatedBy: null,
    });
    const user = await registerAndLoginWebUser({
      firstName: 'Sandbox',
      lastName: 'Test',
      email: SANDBOX_EMAIL,
      password: SANDBOX_PASSWORD,
    });
    token = user.token;
    userId = user.userId || (await findUserByEmail(SANDBOX_EMAIL))?.id || '';
    if (!userId) {
      throw new Error(`Sandbox test setup failed to create local user for ${SANDBOX_EMAIL}`);
    }
  });

  afterAll(async () => {
    delete process.env.STRIPE_BILLING_ENABLED;
    await cleanupTestUsersByEmail([
      SANDBOX_EMAIL,
      `${BASE_SUFFIX}-refund@example.com`,
      `${BASE_SUFFIX}-dispute@example.com`,
    ]);
    await closePool();
  });

  // =========================================================================
  // HTTP surface tests
  // =========================================================================

  it('GET /api/billing/status without Authorization header → 401', async () => {
    await request(app).get('/api/billing/status').expect(401);
  });

  it('GET /api/billing/plans without Authorization header → 401', async () => {
    await request(app).get('/api/billing/plans').expect(401);
  });

  it('POST /api/billing/checkout-session without Authorization header → 401', async () => {
    await request(app)
      .post('/api/billing/checkout-session')
      .send({ planKey: 'premium_monthly', idempotencyKey: 'noauth', clientPlatform: 'web' })
      .expect(401);
  });

  it('POST /api/billing/portal-session without Authorization header → 401', async () => {
    await request(app)
      .post('/api/billing/portal-session')
      .send({})
      .expect(401);
  });

  it('GET /api/billing/status returns free-tier response for new user', async () => {
    const res = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Verify every BillingStatusDto field for the no-subscription baseline.
    expect(res.body.effectiveTier).toBe('free');
    expect(res.body.isBillingManaged).toBe(false);
    expect(res.body.plan).toBeNull();
    expect(res.body.subscriptionStatus).toBeNull();
    expect(res.body.currentPeriodEnd).toBeNull();
    expect(res.body.cancelAtPeriodEnd).toBe(false);
    expect(res.body.inGracePeriod).toBe(false);
    expect(res.body.accessRevoked).toBe(false);
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
    expect(plans.length).toBeGreaterThanOrEqual(2);

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

  it('POST /api/billing/checkout-session creates a real Stripe Checkout URL (monthly)', async () => {
    const idempotencyKey = `sandbox-monthly-${userId}-${Date.now()}`;
    const res = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' });
    expectStatus(res, 201);

    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it('POST /api/billing/checkout-session creates a real Stripe Checkout URL (annual)', async () => {
    const idempotencyKey = `sandbox-annual-${userId}-${Date.now()}`;
    const res = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_annual', idempotencyKey, clientPlatform: 'web' });
    expectStatus(res, 201);

    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it('POST /api/billing/checkout-session is idempotent with the same key — returns exact same URL', async () => {
    // claimBillingCheckout stores the URL on first call; subsequent calls with the same
    // user+planKey return the cached URL. This verifies the claim layer works end-to-end.
    const idempotencyKey = `sandbox-idempotent-${userId}-${Date.now()}`;

    const res1 = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' });
    expectStatus(res1, 201);

    const res2 = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey, clientPlatform: 'web' });
    expectStatus(res2, 201);

    expect(res1.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(res2.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(res1.body.url).toBe(res2.body.url);
  });

  it('POST /api/billing/checkout-session rejects non-web clientPlatform with 400', async () => {
    const res = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'premium_monthly', idempotencyKey: 'native-test', clientPlatform: 'ios' })
      .expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/billing/checkout-session rejects unknown planKey with 400', async () => {
    const res = await request(app)
      .post('/api/billing/checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planKey: 'gold_tier', idempotencyKey: 'bad-plan', clientPlatform: 'web' })
      .expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/billing/plans → 503 when billing is disabled', async () => {
    const prev = process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_BILLING_ENABLED = 'false';
    try {
      const res = await request(app)
        .get('/api/billing/plans')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/billing.*not enabled/i);
    } finally {
      process.env.STRIPE_BILLING_ENABLED = prev;
    }
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
  // Webhook security
  // =========================================================================

  it('webhook when billing is disabled → 503 before signature is checked', async () => {
    // The billing-disabled guard runs before signature verification, so any request
    // body (even unsigned) should produce 503 rather than 400.
    const prev = process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_BILLING_ENABLED = 'false';
    try {
      const res = await request(app)
        .post('/api/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send('{}');
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/billing.*not enabled/i);
    } finally {
      process.env.STRIPE_BILLING_ENABLED = prev;
    }
  });

  it('webhook with forged Stripe-Signature → 400 signature verification failed', async () => {
    const body = JSON.stringify({
      id: 'evt_forged',
      object: 'event',
      type: 'customer.subscription.created',
      data: { object: {} },
    });
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=12345,v1=0000000000000000000000000000000000000000000000000000000000000000')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('webhook without Stripe-Signature header → 400 missing signature', async () => {
    const body = JSON.stringify({ id: 'evt_nosig', object: 'event', type: 'anything', data: { object: {} } });
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('webhook with valid signature but unrecognised event type → 200 with handled=false', async () => {
    const stripe = makeStripe();
    const payload = JSON.stringify({
      id: `evt_unknown_${Date.now()}`,
      object: 'event',
      api_version: STRIPE_API_VERSION,
      type: 'completely.unknown.event.type',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: { id: 'obj_unknown' } },
      request: { id: null, idempotency_key: null },
    });
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.handled).toBe(false);
  });

  it('webhook checkout.session.completed with mode=payment → acknowledged without subscription processing', async () => {
    // The handler guards `if (session.mode !== 'subscription') return` before attempting
    // subscription sync. A one-time payment checkout must not trigger subscription logic.
    const stripe = makeStripe();
    const syntheticSession = {
      id: `cs_test_payment_mode_${Date.now()}`,
      object: 'checkout.session',
      mode: 'payment',
      subscription: null,
      metadata: {},
    };
    const res = await deliverWebhook(stripe, 'checkout.session.completed', syntheticSession);
    expectStatus(res, 200);
    expect(res.body.received).toBe(true);
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
    let stripe: Stripe;
    let sub: Stripe.Subscription;
    let seq = 0;
    const nextId = (tag: string) => `evt_test_${tag}_${Date.now()}_${++seq}`;

    beforeAll(async () => {
      stripe = makeStripe();
      // Create a Stripe customer with our local userId in metadata so that
      // userIdFromSubscription can resolve it without a billing_customers row.
      const customer = await stripe.customers.create({
        email: SANDBOX_EMAIL,
        metadata: { userId },
      });

      // Persist billing_customer so portal and other routes work.
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: customer.id,
        emailSnapshot: SANDBOX_EMAIL,
        livemode: false,
      });

      if (!sandboxMonthlyPriceId) {
        throw new Error(
          'Sandbox monthly Stripe Price ID was not resolved — lifecycle subscription cannot be created',
        );
      }
      sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: sandboxMonthlyPriceId }],
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
      const freshSub = await stripe.subscriptions.retrieve(sub.id);

      const res = await deliverWebhook(stripe, 'customer.subscription.created', freshSub, nextId('sub_created'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);
      expect(res.body.duplicate).toBeFalsy();

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to be stored in DB after customer.subscription.created`);
      expect(stored.stripeSubscriptionId).toBe(sub.id);
      expect(stored.status).toBe('trialing');
      expect(stored.userId).toBe(userId);
      expect(stored.planKey).toBe('premium_monthly');

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('GET /api/billing/status → trialing, checkoutAvailable=false, portalAvailable=true', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.effectiveTier).toBe('premium');
      expect(res.body.subscriptionStatus).toBe('trialing');
      expect(res.body.plan).toBe('monthly');
      expect(res.body.isBillingManaged).toBe(true);
      expect(typeof res.body.currentPeriodEnd).toBe('string');
      expect(res.body.checkoutAvailable).toBe(false);
      expect(res.body.portalAvailable).toBe(true);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.inGracePeriod).toBe(false);
      expect(res.body.accessRevoked).toBe(false);
    });

    it('POST /api/billing/portal-session → 201 with real Stripe portal URL', async () => {
      const res = await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expectStatus(res, 201);
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    });

    it('POST /api/billing/checkout-session → 409 when user already has active subscription', async () => {
      const res = await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', idempotencyKey: `already-sub-${Date.now()}`, clientPlatform: 'web' });
      expectStatus(res, 409);
      expect(res.body.alreadySubscribed).toBe(true);
      expect(typeof res.body.message).toBe('string');
    });

    it('checkout.session.completed webhook → subscription snapshot applied, returns received=true', async () => {
      // Synthesise a minimal checkout.session.completed pointing at our real subscription.
      // The handler re-fetches the subscription from Stripe, so the object contents only
      // need the fields the handler reads (mode, subscription).
      const syntheticSession = {
        id: `cs_test_synthetic_${Date.now()}`,
        object: 'checkout.session',
        mode: 'subscription',
        subscription: sub.id,
        client_reference_id: userId,
        metadata: { userId, planKey: 'premium_monthly' },
      };

      const res = await deliverWebhook(
        stripe,
        'checkout.session.completed',
        syntheticSession,
        nextId('checkout_completed'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      // Subscription should still exist in DB (idempotent upsert).
      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to still be in DB after checkout.session.completed`);
      expect(stored.status).toBe('trialing');
    });

    it('customer.subscription.updated (cancel_at_period_end=true) → DB reflects scheduled cancellation, user still premium', async () => {
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });

      const res = await deliverWebhook(stripe, 'customer.subscription.updated', updated, nextId('sub_updated'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to be in DB after customer.subscription.updated`);
      expect(stored.cancelAtPeriodEnd).toBe(true);

      // Trialing + cancel_at_period_end does not revoke access immediately.
      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('GET /api/billing/status → cancelAtPeriodEnd=true after update', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.effectiveTier).toBe('premium');
      expect(res.body.cancelAtPeriodEnd).toBe(true);
    });

    it('invoice.payment_action_required → subscription snapshot applied but pastDueSince NOT set', async () => {
      // SCA/3DS case: the customer needs to authenticate. We do NOT start the
      // past-due clock — they still have a chance to complete the payment.
      const syntheticInvoice = {
        id: `in_fake_action_required_${Date.now()}`,
        object: 'invoice',
        parent: { subscription_details: { subscription: sub.id } },
        status: 'open',
      };

      const res = await deliverWebhook(
        stripe,
        'invoice.payment_action_required',
        syntheticInvoice,
        nextId('inv_action_required'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      // pastDueSince must remain null — action_required ≠ payment_failed.
      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to be in DB after invoice.payment_action_required`);
      expect(stored.pastDueSince).toBeNull();
    });

    it('invoice.payment_failed → pastDueSince recorded in DB', async () => {
      const syntheticInvoice = {
        id: `in_fake_failed_${Date.now()}`,
        object: 'invoice',
        parent: { subscription_details: { subscription: sub.id } },
        status: 'open',
      };

      const res = await deliverWebhook(stripe, 'invoice.payment_failed', syntheticInvoice, nextId('inv_failed'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to be in DB after invoice.payment_failed`);
      expect(stored.pastDueSince).toBeTruthy();
    });

    it('invoice.payment_failed (second delivery) → pastDueSince preserved, not overwritten', async () => {
      // The handler guards with `if (!existing.pastDueSince)` so a second payment_failed
      // event must not reset the clock to a later timestamp.
      const stored1 = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored1?.pastDueSince) {
        throw new Error(`Expected pastDueSince to already be set before second invoice.payment_failed`);
      }

      const syntheticInvoice = {
        id: `in_fake_failed2_${Date.now()}`,
        object: 'invoice',
        parent: { subscription_details: { subscription: sub.id } },
        status: 'open',
      };

      const res = await deliverWebhook(stripe, 'invoice.payment_failed', syntheticInvoice, nextId('inv_failed2'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored2 = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored2) throw new Error(`Expected subscription ${sub.id} to be in DB after second invoice.payment_failed`);
      expect(new Date(stored2.pastDueSince as any).toISOString()).toBe(
        new Date(stored1.pastDueSince as any).toISOString(),
      );
    });

    it('invoice.paid → pastDueSince cleared, tier remains premium', async () => {
      const syntheticInvoice = {
        id: `in_fake_paid_${Date.now()}`,
        object: 'invoice',
        parent: { subscription_details: { subscription: sub.id } },
        status: 'paid',
      };

      const res = await deliverWebhook(stripe, 'invoice.paid', syntheticInvoice, nextId('inv_paid'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to be in DB after invoice.paid`);
      expect(stored.pastDueSince).toBeNull();

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('duplicate event delivery → second POST returns duplicate=true, DB unchanged', async () => {
      const sharedEventId = `evt_dupe_${Date.now()}`;
      const freshSub = await stripe.subscriptions.retrieve(sub.id);

      const r1 = await deliverWebhook(stripe, 'customer.subscription.updated', freshSub, sharedEventId);
      expectStatus(r1, 200);
      expect(r1.body.received).toBe(true);
      expect(r1.body.duplicate).toBeFalsy();

      // Re-deliver the exact same signed event with the same ID.
      const r2 = await deliverWebhook(stripe, 'customer.subscription.updated', freshSub, sharedEventId);
      expectStatus(r2, 200);
      expect(r2.body.duplicate).toBe(true);
    });

    it('customer.subscription.deleted → status=canceled in DB and tier = free', async () => {
      const canceled = await stripe.subscriptions.cancel(sub.id);
      expect(canceled.status).toBe('canceled');

      const res = await deliverWebhook(stripe, 'customer.subscription.deleted', canceled, nextId('sub_deleted'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(sub.id);
      if (!stored) throw new Error(`Expected subscription ${sub.id} to remain in DB after customer.subscription.deleted`);
      expect(stored.status).toBe('canceled');

      const tier = await getCurrentUserTier(userId);
      expect(tier?.tierKey).toBe('free');
    });

    it('GET /api/billing/status → free tier and portalAvailable=false after subscription deleted', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.effectiveTier).toBe('free');
      // listActiveBillingSubscriptionsForUser excludes status='canceled' rows whose
      // pastDueSince is null, so no subscription appears in billing status after deletion.
      expect(res.body.subscriptionStatus).toBeNull();
      expect(res.body.checkoutAvailable).toBe(true);
      expect(res.body.portalAvailable).toBe(false);
      expect(res.body.accessRevoked).toBe(false);
    });
  });

  // =========================================================================
  // Webhook simulation — dispute revocation and restoration
  //
  // Creates a separate user + subscription WITHOUT a trial so a charge is
  // produced immediately. Dispute events are delivered synthetically with the
  // real charge ID so the handler can traverse charge → customer → subscription.
  // =========================================================================

  describe('webhook simulation — dispute revocation and restoration', () => {
    let stripe: Stripe;
    const DISPUTE_EMAIL = `${BASE_SUFFIX}-dispute@example.com`;

    let disputeUserId: string;
    let disputeToken: string;
    let disputeSub: Stripe.Subscription;
    let disputeChargeId: string;
    let seq = 0;
    const nextId = (tag: string) => `evt_test_${tag}_${Date.now()}_${++seq}`;

    beforeAll(async () => {
      stripe = makeStripe();

      const disputeUser = await registerAndLoginWebUser({
        firstName: 'Dispute',
        lastName: 'Test',
        email: DISPUTE_EMAIL,
        password: SANDBOX_PASSWORD,
      });
      disputeUserId = disputeUser.userId || (await findUserByEmail(DISPUTE_EMAIL))?.id || '';
      disputeToken = disputeUser.token;
      if (!disputeUserId) {
        throw new Error(`Sandbox dispute test setup failed to create local user for ${DISPUTE_EMAIL}`);
      }

      const customer = await stripe.customers.create({
        email: DISPUTE_EMAIL,
        metadata: { userId: disputeUserId },
      });

      await upsertBillingCustomer({
        userId: disputeUserId,
        stripeCustomerId: customer.id,
        emailSnapshot: DISPUTE_EMAIL,
        livemode: false,
      });

      await attachTestCard(stripe, customer.id);

      if (!sandboxMonthlyPriceId) {
        throw new Error(
          'Sandbox monthly Stripe Price ID was not resolved — dispute subscription cannot be created',
        );
      }
      const result = await createPaidSubscription(stripe, customer.id, sandboxMonthlyPriceId, {
        userId: disputeUserId,
        planKey: 'premium_monthly',
      });
      disputeSub = result.sub;
      disputeChargeId = result.chargeId;
    });

    afterAll(async () => {
      if (disputeSub?.id) {
        await stripe.subscriptions.cancel(disputeSub.id).catch(() => undefined);
      }
    });

    it('initial subscription synced to DB and user tier = premium', async () => {
      const freshSub = await stripe.subscriptions.retrieve(disputeSub.id);

      const res = await deliverWebhook(stripe, 'customer.subscription.created', freshSub, nextId('sub_created'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(disputeSub.id);
      if (!stored) {
        throw new Error(`Expected subscription ${disputeSub.id} to be in DB after customer.subscription.created`);
      }
      expect(stored.status).toBe('active');
      expect(stored.userId).toBe(disputeUserId);

      const tier = await getCurrentUserTier(disputeUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('charge.dispute.created → accessRevokedAt set and tier = free', async () => {
      // Synthesise a dispute object. The handler calls stripe.charges.retrieve(disputeChargeId)
      // so the real chargeId must belong to the dispute customer.
      const syntheticDispute = {
        id: `dp_test_${Date.now()}`,
        object: 'dispute',
        charge: disputeChargeId,
        status: 'needs_response',
        amount: 500,
        currency: 'usd',
        reason: 'fraudulent',
        created: Math.floor(Date.now() / 1000),
      };

      const res = await deliverWebhook(
        stripe,
        'charge.dispute.created',
        syntheticDispute,
        nextId('dispute_created'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(disputeSub.id);
      if (!stored) {
        throw new Error(
          `Expected subscription ${disputeSub.id} to be in DB after charge.dispute.created. ` +
          `chargeId=${disputeChargeId}`,
        );
      }
      expect(stored.accessRevokedAt).toBeTruthy();
      expect(stored.accessRevocationReason).toBe('dispute');

      const tier = await getCurrentUserTier(disputeUserId);
      expect(tier?.tierKey).toBe('free');
    });

    it('charge.dispute.closed (status=lost) → access stays revoked, tier remains free', async () => {
      const syntheticDispute = {
        id: `dp_test_${Date.now()}`,
        object: 'dispute',
        charge: disputeChargeId,
        status: 'lost',
        amount: 500,
        currency: 'usd',
        reason: 'fraudulent',
        created: Math.floor(Date.now() / 1000),
      };

      const res = await deliverWebhook(
        stripe,
        'charge.dispute.closed',
        syntheticDispute,
        nextId('dispute_lost'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      // Lost dispute keeps revocation in place — accessRevocationReason must not be cleared.
      const stored = await getBillingSubscriptionByStripeId(disputeSub.id);
      if (!stored) {
        throw new Error(`Expected subscription ${disputeSub.id} to be in DB after charge.dispute.closed (lost)`);
      }
      expect(stored.accessRevokedAt).toBeTruthy();
      expect(stored.accessRevocationReason).toBe('dispute');

      const tier = await getCurrentUserTier(disputeUserId);
      expect(tier?.tierKey).toBe('free');
    });

    it('charge.dispute.closed (status=won) → accessRevokedAt cleared and tier = premium', async () => {
      const syntheticDispute = {
        id: `dp_test_${Date.now()}`,
        object: 'dispute',
        charge: disputeChargeId,
        status: 'won',
        amount: 500,
        currency: 'usd',
        reason: 'fraudulent',
        created: Math.floor(Date.now() / 1000),
      };

      const res = await deliverWebhook(
        stripe,
        'charge.dispute.closed',
        syntheticDispute,
        nextId('dispute_won'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(disputeSub.id);
      if (!stored) {
        throw new Error(`Expected subscription ${disputeSub.id} to be in DB after charge.dispute.closed (won)`);
      }
      expect(stored.accessRevokedAt).toBeNull();

      const tier = await getCurrentUserTier(disputeUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('GET /api/billing/status reflects premium tier after dispute won', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${disputeToken}`)
        .expect(200);

      // After dispute.closed (won): accessRevokedAt cleared, tier restored to premium.
      // Subscription is still active so all billing status fields should reflect normal state.
      expect(res.body.effectiveTier).toBe('premium');
      expect(res.body.isBillingManaged).toBe(true);
      expect(res.body.plan).toBe('monthly');
      expect(res.body.subscriptionStatus).toBe('active');
      expect(res.body.inGracePeriod).toBe(false);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.accessRevoked).toBe(false);
      expect(res.body.portalAvailable).toBe(true);
      // checkoutAvailable=false because an eligible subscription exists.
      expect(res.body.checkoutAvailable).toBe(false);
    });
  });

  // =========================================================================
  // Webhook simulation — full refund revocation
  //
  // Creates a separate subscription WITHOUT a trial so an invoice is
  // generated and charged immediately. The charge is then refunded via the
  // Stripe API and charge.refunded / refund.updated events are delivered
  // to the webhook.
  // =========================================================================

  describe('webhook simulation — full refund revocation', () => {
    let stripe: Stripe;
    const REFUND_EMAIL = `${BASE_SUFFIX}-refund@example.com`;

    let refundUserId: string;
    let refundToken: string;
    let refundSub: Stripe.Subscription;
    let chargeId: string;
    let partialRefundId: string;
    let seq = 0;
    const nextId = (tag: string) => `evt_test_${tag}_${Date.now()}_${++seq}`;

    beforeAll(async () => {
      stripe = makeStripe();

      const refundUser = await registerAndLoginWebUser({
        firstName: 'Refund',
        lastName: 'Test',
        email: REFUND_EMAIL,
        password: SANDBOX_PASSWORD,
      });
      refundUserId = refundUser.userId || (await findUserByEmail(REFUND_EMAIL))?.id || '';
      refundToken = refundUser.token;
      if (!refundUserId) {
        throw new Error(`Sandbox refund test setup failed to create local user for ${REFUND_EMAIL}`);
      }

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

      await attachTestCard(stripe, customer.id);

      if (!sandboxMonthlyPriceId) {
        throw new Error(
          'Sandbox monthly Stripe Price ID was not resolved — refund subscription cannot be created',
        );
      }
      const result = await createPaidSubscription(stripe, customer.id, sandboxMonthlyPriceId, {
        userId: refundUserId,
        planKey: 'premium_monthly',
      });
      refundSub = result.sub;
      chargeId = result.chargeId;
    });

    afterAll(async () => {
      if (refundSub?.id) {
        await stripe.subscriptions.cancel(refundSub.id).catch(() => undefined);
      }
    });

    it('initial subscription synced to DB and user tier = premium', async () => {
      const freshSub = await stripe.subscriptions.retrieve(refundSub.id);

      const res = await deliverWebhook(stripe, 'customer.subscription.created', freshSub, nextId('sub_created'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      if (!stored) {
        throw new Error(`Expected subscription ${refundSub.id} to be in DB after customer.subscription.created`);
      }
      expect(stored.status).toBe('active');
      expect(stored.userId).toBe(refundUserId);

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('partial refund + charge.refunded → no entitlement change, tier stays premium', async () => {
      const chargeObj = await stripe.charges.retrieve(chargeId);
      const partialAmount = Math.floor(chargeObj.amount / 2);
      const refund = await stripe.refunds.create({ charge: chargeId, amount: partialAmount });
      partialRefundId = refund.id;

      const partiallyRefundedCharge = await stripe.charges.retrieve(chargeId);
      expect(partiallyRefundedCharge.amount_refunded).toBe(partialAmount);
      expect(partiallyRefundedCharge.refunded).toBe(false);

      const res = await deliverWebhook(
        stripe,
        'charge.refunded',
        partiallyRefundedCharge,
        nextId('partial_refund'),
      );
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      // Partial refund must not revoke access.
      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      if (!stored) throw new Error(`Expected subscription ${refundSub.id} to be in DB after partial refund`);
      expect(stored.accessRevokedAt).toBeNull();

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('refund.updated for partial refund → no entitlement change (re-evaluates same partial state)', async () => {
      // The refund.updated handler re-fetches the real charge from Stripe and re-evaluates
      // the net refunded amount. With partial=true the charge is still not fully refunded,
      // so no access change should occur.
      const syntheticRefund = {
        id: partialRefundId,
        object: 'refund',
        charge: chargeId,
        status: 'succeeded',
      };

      const res = await deliverWebhook(stripe, 'refund.updated', syntheticRefund, nextId('refund_updated'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      if (!stored) throw new Error(`Expected subscription ${refundSub.id} to be in DB after refund.updated`);
      expect(stored.accessRevokedAt).toBeNull();
    });

    it('refund.failed for partial refund → no entitlement change (same handler as refund.updated, different event type)', async () => {
      // refund.failed uses the same handler as refund.updated. Deliver it while the charge is
      // still only partially refunded; re-evaluation of the charge state must not revoke access.
      const syntheticRefund = {
        id: partialRefundId,
        object: 'refund',
        charge: chargeId,
        status: 'failed',
      };

      const res = await deliverWebhook(stripe, 'refund.failed', syntheticRefund, nextId('refund_failed'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      if (!stored) throw new Error(`Expected subscription ${refundSub.id} to be in DB after refund.failed`);
      expect(stored.accessRevokedAt).toBeNull();

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('premium');
    });

    it('full refund + charge.refunded → accessRevokedAt set, accessRevocationReason=full_refund, tier = free', async () => {
      const chargeObj = await stripe.charges.retrieve(chargeId);
      const remaining = chargeObj.amount - chargeObj.amount_refunded;
      await stripe.refunds.create({ charge: chargeId, amount: remaining });

      const fullyRefundedCharge = await stripe.charges.retrieve(chargeId);
      expect(fullyRefundedCharge.refunded).toBe(true);
      expect(fullyRefundedCharge.amount_refunded).toBe(fullyRefundedCharge.amount);

      const res = await deliverWebhook(stripe, 'charge.refunded', fullyRefundedCharge, nextId('full_refund'));
      expectStatus(res, 200);
      expect(res.body.received).toBe(true);

      const stored = await getBillingSubscriptionByStripeId(refundSub.id);
      if (!stored) throw new Error(`Expected subscription ${refundSub.id} to be in DB after full refund`);
      expect(stored.accessRevokedAt).toBeTruthy();
      expect(stored.accessRevocationReason).toBe('full_refund');
      expect(stored.refundedAt).toBeTruthy();

      const tier = await getCurrentUserTier(refundUserId);
      expect(tier?.tierKey).toBe('free');
    });

    it('GET /api/billing/status → effectiveTier=free and accessRevoked=true after full refund', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${refundToken}`)
        .expect(200);

      // The subscription is still 'active' in Stripe (not cancelled) but access is revoked.
      // listActiveBillingSubscriptionsForUser includes it because status ≠ 'canceled'.
      // primarySub = subscriptions[0] (no eligible sub); billing status surfaces its fields.
      // isBillingManaged=true because reconcileUserTierFromBilling set source='billing' to 'free'.
      expect(res.body.effectiveTier).toBe('free');
      expect(res.body.isBillingManaged).toBe(true);
      expect(res.body.plan).toBe('monthly');
      expect(res.body.subscriptionStatus).toBe('active');
      expect(res.body.inGracePeriod).toBe(false);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.accessRevoked).toBe(true);
      // portalAvailable because the revoked subscription is still returned by active list.
      expect(res.body.portalAvailable).toBe(true);
      // checkoutAvailable because no eligible sub remains after revocation.
      expect(res.body.checkoutAvailable).toBe(true);
    });
  });
});
