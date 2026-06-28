/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  getBillingPlanConfig,
  closePool,
  upsertBillingPlanConfig,
  upsertBillingSubscription,
  getBillingSubscriptionByStripeId,
  revokeBillingSubscriptionAccess,
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  upsertBillingCustomer,
  getBillingTrialUsageByEmail,
  markBillingTrialUsed,
} from '../src/db';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const EMAIL = `billing-routes-test+${TS}@example.com`;
const PASSWORD = 'BillingTest1!';

const makeFakeStripe = (overrides: Record<string, any> = {}) => ({
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test_fake' }),
    update: jest.fn().mockResolvedValue({}),
  },
  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        id: 'cs_test_fake',
        url: 'https://checkout.stripe.com/pay/cs_test_fake',
      }),
    },
  },
  billingPortal: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        url: 'https://billing.stripe.com/session/test',
      }),
    },
  },
  subscriptions: {
    list: jest.fn().mockResolvedValue({ data: [] }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_test',
      status: 'active',
      livemode: false,
      customer: 'cus_test_fake',
      cancel_at_period_end: false,
      cancel_at: null,
      trial_end: null,
      ended_at: null,
      latest_invoice: null,
      metadata: { userId: '', planKey: 'premium_monthly' },
      // current_period_start/end live on items.data[0] in Stripe API v2026-06-24.dahlia —
      // mapStripeSubscriptionToUpsert reads sub.items.data[0]?.current_period_{start,end}.
      items: {
        data: [{
          price: { id: 'price_test_monthly' },
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        }],
      },
    }),
    cancel: jest.fn().mockResolvedValue({}),
  },
  invoices: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'in_test',
      parent: { subscription_details: { subscription: 'sub_test' } },
    }),
  },
  charges: {
    retrieve: jest.fn().mockResolvedValue({ id: 'ch_test', invoice: 'in_test' }),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
  ...overrides,
});

describe('Billing routes', () => {
  let token: string;
  let userId: string;
  let fakeStripe: ReturnType<typeof makeFakeStripe>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_test_monthly';
    process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID = 'price_test_annual';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://localhost:19006/?billing=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:19006/?billing=cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:19006/';

    await initDb();
    await upsertBillingPlanConfig({
      planKey: 'premium_monthly',
      activeStripePriceId: 'price_test_monthly',
      unitAmountCents: 500,
      currency: 'usd',
      interval: 'month',
      trialDays: 14,
      pastDueGraceDays: 30,
      automaticTaxEnabled: true,
      promotionCodesEnabled: true,
      isCheckoutEnabled: true,
      livemode: false,
      updatedBy: null,
    });
    await upsertBillingPlanConfig({
      planKey: 'premium_annual',
      activeStripePriceId: 'price_test_annual',
      unitAmountCents: 3500,
      currency: 'usd',
      interval: 'year',
      trialDays: 14,
      pastDueGraceDays: 30,
      automaticTaxEnabled: true,
      promotionCodesEnabled: true,
      isCheckoutEnabled: true,
      livemode: false,
      updatedBy: null,
    });
    const user = await registerAndLoginWebUser({ firstName: 'Billing', lastName: 'Test', email: EMAIL, password: PASSWORD });
    token = user.token;
    userId = user.userId;

    fakeStripe = makeFakeStripe();
    setStripeClientForTesting(fakeStripe as any);
  });

  afterAll(async () => {
    setStripeClientForTesting(null);
    delete process.env.STRIPE_BILLING_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
    delete process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID;
    delete process.env.STRIPE_CHECKOUT_SUCCESS_URL;
    delete process.env.STRIPE_CHECKOUT_CANCEL_URL;
    delete process.env.STRIPE_PORTAL_RETURN_URL;
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  describe('GET /api/billing/status', () => {
    it('requires authentication', async () => {
      await request(app).get('/api/billing/status').expect(401);
    });

    it('returns complete BillingStatusDto for a free user (no subscription)', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify every field of BillingStatusDto for the no-subscription baseline.
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

    it('returns 200 when billing is disabled — status route intentionally bypasses the billing guard', async () => {
      // GET /api/billing/status has no billingEnabled guard so the frontend can
      // always read the current tier (including admin-granted tiers) even when
      // Stripe is toggled off.
      const saved = process.env.STRIPE_BILLING_ENABLED;
      process.env.STRIPE_BILLING_ENABLED = 'false';
      try {
        const res = await request(app)
          .get('/api/billing/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(res.body.effectiveTier).toBe('free');
      } finally {
        process.env.STRIPE_BILLING_ENABLED = saved;
      }
    });
  });

  describe('GET /api/billing/plans', () => {
    it('requires authentication', async () => {
      await request(app).get('/api/billing/plans').expect(401);
    });

    it('returns 503 with a clear error when billing is disabled', async () => {
      const saved = process.env.STRIPE_BILLING_ENABLED;
      process.env.STRIPE_BILLING_ENABLED = 'false';
      try {
        const res = await request(app)
          .get('/api/billing/plans')
          .set('Authorization', `Bearer ${token}`)
          .expect(503);
        expect(res.body.error).toBe('Billing is not enabled on this server.');
      } finally {
        process.env.STRIPE_BILLING_ENABLED = saved;
      }
    });

    it('returns available plans', async () => {
      const res = await request(app)
        .get('/api/billing/plans')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.plans).toBeDefined();
      expect(Array.isArray(res.body.plans)).toBe(true);
      const monthly = res.body.plans.find((p: any) => p.planKey === 'premium_monthly');
      expect(monthly).toBeDefined();
      expect(monthly.amountCents).toBe(500);
      expect(monthly.currency).toBe('usd');
      expect(monthly.interval).toBe('month');
      expect(monthly.trialDays).toBe(14);

      const annual = res.body.plans.find((p: any) => p.planKey === 'premium_annual');
      expect(annual).toBeDefined();
      expect(annual.amountCents).toBe(3500);
      expect(annual.currency).toBe('usd');
      expect(annual.interval).toBe('year');
    });

    it('does not advertise plans disabled by an administrator', async () => {
      await upsertBillingPlanConfig({
        planKey: 'premium_annual',
        isCheckoutEnabled: false,
        updatedBy: userId,
      });
      try {
        const res = await request(app)
          .get('/api/billing/plans')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(res.body.plans.some((plan: any) => plan.planKey === 'premium_annual')).toBe(false);
      } finally {
        await upsertBillingPlanConfig({
          planKey: 'premium_annual',
          isCheckoutEnabled: true,
          updatedBy: userId,
        });
      }
    });
  });

  describe('POST /api/billing/checkout-session', () => {
    it('requires authentication', async () => {
      await request(app)
        .post('/api/billing/checkout-session')
        .send({ planKey: 'premium_monthly', idempotencyKey: 'test-key', clientPlatform: 'web' })
        .expect(401);
    });

    it('returns 503 with a clear error when billing is disabled', async () => {
      const saved = process.env.STRIPE_BILLING_ENABLED;
      process.env.STRIPE_BILLING_ENABLED = 'false';
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `disabled-billing-${TS}`, clientPlatform: 'web' })
          .expect(503);
        expect(res.body.error).toBe('Billing is not enabled on this server.');
      } finally {
        process.env.STRIPE_BILLING_ENABLED = saved;
      }
    });

    it('rejects invalid plan key', async () => {
      const res = await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'hacker_free', idempotencyKey: 'test-key-1', clientPlatform: 'web' })
        .expect(400);
      expect(res.body.error).toBe('Request validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'planKey' }),
        ]),
      );
    });

    it('rejects missing idempotency key', async () => {
      const res = await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', clientPlatform: 'web' })
        .expect(400);
      expect(res.body.error).toBe('Request validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'idempotencyKey' }),
        ]),
      );
    });

    it('rejects native checkout requests', async () => {
      const res = await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', idempotencyKey: 'native-test', clientPlatform: 'ios' })
        .expect(400);
      expect(res.body.error).toBe('Request validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'clientPlatform' }),
        ]),
      );
    });

    it('creates a checkout session and returns a URL', async () => {
      const res = await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', idempotencyKey: `test-key-${TS}`, clientPlatform: 'web' })
        .expect(201);

      expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_test_fake');
      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalled();
      const call = fakeStripe.checkout.sessions.create.mock.calls[0][0];
      // Must never have client-supplied amount or Price ID
      expect(call.line_items[0].price).toBe('price_test_monthly');
      expect(call.mode).toBe('subscription');
      expect(call.payment_method_types).toBeUndefined();
      expect(call.client_reference_id).toBe(userId);
      expect(call.metadata).toEqual({ userId, planKey: 'premium_monthly' });
      expect(call.subscription_data.metadata).toEqual({ userId, planKey: 'premium_monthly' });
      expect(call.subscription_data.trial_period_days).toBe(14);
      expect(call.success_url).toBe('http://localhost:19006/?billing=success');
      expect(call.cancel_url).toBe('http://localhost:19006/?billing=cancel');
      expect(call.automatic_tax.enabled).toBe(true);
      expect(call.billing_address_collection).toBe('required');
      expect(call.allow_promotion_codes).toBe(true);
      expect(call.customer_update).toEqual({ address: 'auto', name: 'auto' });
      expect(fakeStripe.checkout.sessions.create.mock.calls[0][1]).toEqual({ idempotencyKey: `test-key-${TS}` });
      const trialUsage = await getBillingTrialUsageByEmail(EMAIL.toLowerCase());
      expect(trialUsage).toMatchObject({
        emailNormalized: EMAIL.toLowerCase(),
        userId,
        stripeCustomerId: 'cus_test_fake',
      });
    });

    it('does not grant a second free trial after a previous canceled subscription used the trial', async () => {
      const usedEmail = `billing-trial-used+${TS}@example.com`;
      const used = await registerAndLoginWebUser({
        firstName: 'Trial',
        lastName: 'Used',
        email: usedEmail,
        password: PASSWORD,
      });
      await upsertBillingSubscription({
        stripeSubscriptionId: `sub_trial_used_canceled_${TS}`,
        userId: used.userId,
        scopeOwnerId: used.userId,
        stripeCustomerId: 'cus_previous_trial',
        stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly',
        status: 'canceled',
        livemode: false,
        cancelAtPeriodEnd: false,
        trialEnd: new Date(Date.now() - 86_400_000),
        endedAt: new Date(Date.now() - 3_600_000),
      });
      await markBillingTrialUsed({
        emailNormalized: usedEmail.toLowerCase(),
        userId: used.userId,
        stripeCustomerId: 'cus_previous_trial',
        stripeSubscriptionId: `sub_trial_used_canceled_${TS}`,
        trialUsedAt: new Date(Date.now() - 86_400_000),
      });

      try {
        await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${used.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `trial-used-${TS}`, clientPlatform: 'web' })
          .expect(201);

        const call = fakeStripe.checkout.sessions.create.mock.calls.at(-1)[0];
        expect(call.subscription_data.trial_period_days).toBeUndefined();
      } finally {
        await cleanupTestUsersByEmail([usedEmail]);
      }
    });

    it('uses admin-configured price, trial, tax, and promotion settings', async () => {
      const configuredEmail = `billing-configured+${TS}@example.com`;
      const configured = await registerAndLoginWebUser({
        firstName: 'Configured',
        lastName: 'Billing',
        email: configuredEmail,
        password: PASSWORD,
      });
      await upsertBillingPlanConfig({
        planKey: 'premium_annual',
        activeStripePriceId: 'price_admin_annual',
        unitAmountCents: 4200,
        trialDays: 7,
        automaticTaxEnabled: false,
        promotionCodesEnabled: false,
        livemode: false,
        updatedBy: userId,
      });

      try {
        await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${configured.token}`)
          .send({ planKey: 'premium_annual', idempotencyKey: `admin-config-${TS}`, clientPlatform: 'web' })
          .expect(201);

        const call = fakeStripe.checkout.sessions.create.mock.calls.at(-1)[0];
        expect(call.line_items[0].price).toBe('price_admin_annual');
        expect(call.subscription_data.trial_period_days).toBe(7);
        expect(call.automatic_tax.enabled).toBe(false);
        expect(call.allow_promotion_codes).toBe(false);
      } finally {
        await cleanupTestUsersByEmail([configuredEmail]);
      }
    });

    it('returns 409 if user already has an active subscription', async () => {
      const subscribedEmail = `billing-subscribed+${TS}@example.com`;
      const subscribed = await registerAndLoginWebUser({
        firstName: 'Already',
        lastName: 'Subscribed',
        email: subscribedEmail,
        password: PASSWORD,
      });
      await upsertBillingSubscription({
        stripeSubscriptionId: `sub_already_${TS}`,
        userId: subscribed.userId,
        scopeOwnerId: subscribed.userId,
        stripeCustomerId: `cus_already_${TS}`,
        stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly',
        status: 'active',
        livemode: false,
        cancelAtPeriodEnd: false,
      });
      const callsBefore = fakeStripe.checkout.sessions.create.mock.calls.length;
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${subscribed.token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `already-${TS}`,
            clientPlatform: 'web',
          })
          .expect(409);
        expect(res.body.alreadySubscribed).toBe(true);
        expect(res.body.message).toBe('You already have an active Premium subscription. Use Manage Subscription to make changes.');
        expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledTimes(callsBefore);
      } finally {
        await cleanupTestUsersByEmail([subscribedEmail]);
      }
    });

    it('creates only one Stripe session for concurrent checkout requests', async () => {
      const concurrentEmail = `billing-concurrent+${TS}@example.com`;
      const concurrent = await registerAndLoginWebUser({
        firstName: 'Concurrent',
        lastName: 'Checkout',
        email: concurrentEmail,
        password: PASSWORD,
      });
      const originalCreate = fakeStripe.checkout.sessions.create;
      const delayedCreate = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          id: `cs_concurrent_${TS}`,
          url: `https://checkout.stripe.com/pay/cs_concurrent_${TS}`,
        };
      });
      fakeStripe.checkout.sessions.create = delayedCreate;
      try {
        const requests = ['a', 'b'].map((suffix) =>
          request(app)
            .post('/api/billing/checkout-session')
            .set('Authorization', `Bearer ${concurrent.token}`)
            .send({
              planKey: 'premium_monthly',
              idempotencyKey: `concurrent-${suffix}-${TS}`,
              clientPlatform: 'web',
            }),
        );
        const responses = await Promise.all(requests);
        const statuses = responses.map((response) => response.status).sort();
        expect(statuses[0]).toBe(201);
        expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
        expect(delayedCreate).toHaveBeenCalledTimes(1);
        const checkoutUrls = responses
          .filter((response) => response.status === 201)
          .map((response) => response.body.url);
        expect(checkoutUrls).toContain(`https://checkout.stripe.com/pay/cs_concurrent_${TS}`);
        expect(new Set(checkoutUrls).size).toBe(1);
      } finally {
        fakeStripe.checkout.sessions.create = originalCreate;
        await cleanupTestUsersByEmail([concurrentEmail]);
      }
    });

    it('returns the cached checkout URL when a pending claim exists — no new Stripe session created', async () => {
      // createCheckoutSession stores claimToken = `${idempotencyKey}:${Date.now()}`, so
      // two requests with different idempotency keys produce different claimTokens.
      // After the first request succeeds, billing_checkout_claims holds the session URL.
      // A second request (new idempotency key, same user) hits claimBillingCheckout →
      // INSERT conflicts on user_id → claim is still live → returns { claimed:false, checkoutUrl }.
      // createCheckoutSession returns that URL directly without calling Stripe again.
      const cachedEmail = `billing-cached-url+${TS}@example.com`;
      const cachedUser = await registerAndLoginWebUser({
        firstName: 'Cached', lastName: 'Url', email: cachedEmail, password: PASSWORD,
      });
      try {
        const first = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${cachedUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `cached-first-${TS}`, clientPlatform: 'web' })
          .expect(201);
        const cachedUrl = first.body.url;
        expect(cachedUrl).toBeTruthy();

        // Second request with a fresh idempotency key: must get the same URL, no new Stripe call.
        const callsBefore = fakeStripe.checkout.sessions.create.mock.calls.length;
        const second = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${cachedUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `cached-second-${TS}`, clientPlatform: 'web' })
          .expect(201);

        expect(second.body.url).toBe(cachedUrl);
        expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledTimes(callsBefore);
      } finally {
        await cleanupTestUsersByEmail([cachedEmail]);
      }
    });

    it('returns 409 with a human-readable message when a claim exists but has no URL yet', async () => {
      // When the first checkout is still in-flight (claim created, Stripe not yet responded),
      // a concurrent request from the same user finds the claim with checkoutUrl=null and
      // returns 409 with a message explaining the user should wait and retry.
      // The concurrent test (above) exercises this path; this test pins the exact message.
      const inFlightEmail = `billing-inflight+${TS}@example.com`;
      const inFlightUser = await registerAndLoginWebUser({
        firstName: 'InFlight', lastName: 'Checkout', email: inFlightEmail, password: PASSWORD,
      });
      const originalCreate = fakeStripe.checkout.sessions.create;
      // Block Stripe response indefinitely to leave the claim with checkoutUrl=null.
      let unblock: (() => void) | null = null;
      const blocked = jest.fn(() => new Promise<never>((_, reject) => {
        unblock = () => reject(new Error('test teardown'));
      }));
      fakeStripe.checkout.sessions.create = blocked;

      let firstRequest: Promise<any>;
      try {
        firstRequest = request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${inFlightUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `inflight-first-${TS}`, clientPlatform: 'web' });

        // Give the first request time to claim the slot before the second request arrives.
        await new Promise((resolve) => setTimeout(resolve, 20));

        const second = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${inFlightUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `inflight-second-${TS}`, clientPlatform: 'web' })
          .expect(409);

        expect(second.body.alreadySubscribed).toBe(true);
        expect(second.body.message).toBe('A Premium checkout is already being created. Wait a moment and try again.');
      } finally {
        fakeStripe.checkout.sessions.create = originalCreate;
        unblock?.();
        await firstRequest!.catch(() => undefined);
        await cleanupTestUsersByEmail([inFlightEmail]);
      }
    });

    it('returns 400 with details when the selected plan is disabled', async () => {
      await upsertBillingPlanConfig({
        planKey: 'premium_monthly',
        isCheckoutEnabled: false,
        updatedBy: userId,
      });
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `disabled-${TS}`,
            clientPlatform: 'web',
          })
          .expect(400);
        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
          details: 'Checkout is disabled for plan: premium_monthly',
        });
      } finally {
        await upsertBillingPlanConfig({
          planKey: 'premium_monthly',
          isCheckoutEnabled: true,
          updatedBy: userId,
        });
      }
    });

    it('returns 400 with details when checkout redirect URLs are invalid for Stripe', async () => {
      const originalSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL;
      process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'not-a-url';
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `bad-url-${TS}`,
            clientPlatform: 'web',
          })
          .expect(400);
        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
        });
        expect(res.body.details).toContain('STRIPE_CHECKOUT_SUCCESS_URL must be an absolute http(s) URL');
      } finally {
        process.env.STRIPE_CHECKOUT_SUCCESS_URL = originalSuccessUrl;
      }
    });

    it('returns 400 with details when the configured Price belongs to the wrong Stripe mode', async () => {
      const originalConfig = await getBillingPlanConfig('premium_monthly');
      await upsertBillingPlanConfig({
        planKey: 'premium_monthly',
        activeStripePriceId: 'price_live_mode_mismatch',
        isCheckoutEnabled: true,
        livemode: true,
        updatedBy: userId,
      });
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `wrong-mode-${TS}`,
            clientPlatform: 'web',
          })
          .expect(400);

        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
          details: 'The active billing configuration for premium_monthly belongs to the wrong Stripe mode',
        });
      } finally {
        await upsertBillingPlanConfig({
          ...(originalConfig ?? {}),
          planKey: 'premium_monthly',
          activeStripePriceId: originalConfig?.activeStripePriceId ?? 'price_test_monthly',
          livemode: originalConfig?.livemode ?? false,
          updatedBy: userId,
        });
      }
    });

    it('returns 400 with details when no active Stripe Price ID is configured', async () => {
      const originalConfig = await getBillingPlanConfig('premium_monthly');
      const originalEnvPrice = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
      delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
      await upsertBillingPlanConfig({
        planKey: 'premium_monthly',
        activeStripePriceId: null,
        isCheckoutEnabled: true,
        livemode: false,
        updatedBy: userId,
      });
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `missing-price-${TS}`,
            clientPlatform: 'web',
          })
          .expect(400);

        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
        });
        expect(res.body.details).toContain('No active Price ID configured for plan: premium_monthly');
      } finally {
        if (originalEnvPrice == null) delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
        else process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = originalEnvPrice;
        await upsertBillingPlanConfig({
          ...(originalConfig ?? {}),
          planKey: 'premium_monthly',
          activeStripePriceId: originalConfig?.activeStripePriceId ?? 'price_test_monthly',
          livemode: originalConfig?.livemode ?? false,
          updatedBy: userId,
        });
      }
    });

    it('returns 500 with Stripe failure details when Checkout session creation fails', async () => {
      const failureEmail = `billing-checkout-fail+${TS}@example.com`;
      const failureUser = await registerAndLoginWebUser({
        firstName: 'Checkout',
        lastName: 'Failure',
        email: failureEmail,
        password: PASSWORD,
      });
      fakeStripe.checkout.sessions.create.mockRejectedValueOnce(new Error('Stripe checkout unavailable'));
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${failureUser.token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `stripe-failure-${TS}`,
            clientPlatform: 'web',
          })
          .expect(500);

        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
          details: 'Stripe checkout unavailable',
        });
      } finally {
        await cleanupTestUsersByEmail([failureEmail]);
      }
    });

    it('releases the checkout claim after a Stripe failure so the user can retry checkout', async () => {
      // If releaseBillingCheckoutClaim is NOT called when Stripe.checkout.sessions.create
      // throws, the billing_checkout_claims row for this user is left with checkout_url=null.
      // The next request (with a new idempotencyKey) then hits the "claim exists but has no
      // URL" path and returns 409 "A checkout for this plan is already being processed"
      // instead of creating a fresh session.  This test catches that regression.
      const retryEmail = `billing-checkout-retry+${TS}@example.com`;
      const retryUser = await registerAndLoginWebUser({
        firstName: 'Checkout',
        lastName: 'Retry',
        email: retryEmail,
        password: PASSWORD,
      });
      try {
        fakeStripe.checkout.sessions.create.mockRejectedValueOnce(new Error('Stripe temporarily down'));
        await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${retryUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `retry-fail-${TS}`, clientPlatform: 'web' })
          .expect(500);

        // Retry with a fresh idempotency key — must get 201, not 409.
        const retryRes = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${retryUser.token}`)
          .send({ planKey: 'premium_monthly', idempotencyKey: `retry-success-${TS}`, clientPlatform: 'web' })
          .expect(201);

        expect(retryRes.body.url).toBe('https://checkout.stripe.com/pay/cs_test_fake');
      } finally {
        await cleanupTestUsersByEmail([retryEmail]);
      }
    });

    it('returns 500 with details when Stripe returns a Checkout session without a URL', async () => {
      const noUrlEmail = `billing-checkout-no-url+${TS}@example.com`;
      const noUrlUser = await registerAndLoginWebUser({
        firstName: 'Checkout',
        lastName: 'NoUrl',
        email: noUrlEmail,
        password: PASSWORD,
      });
      fakeStripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_no_url', url: null });
      try {
        const res = await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${noUrlUser.token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `stripe-no-url-${TS}`,
            clientPlatform: 'web',
          })
          .expect(500);

        expect(res.body).toMatchObject({
          error: 'Failed to create checkout session.',
          details: '[billing] Stripe returned a Checkout session without a URL',
        });
      } finally {
        await cleanupTestUsersByEmail([noUrlEmail]);
      }
    });
  });

  describe('POST /api/billing/portal-session', () => {
    it('requires authentication', async () => {
      await request(app).post('/api/billing/portal-session').expect(401);
    });

    it('returns 503 with a clear error when billing is disabled', async () => {
      const saved = process.env.STRIPE_BILLING_ENABLED;
      process.env.STRIPE_BILLING_ENABLED = 'false';
      try {
        const res = await request(app)
          .post('/api/billing/portal-session')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(503);
        expect(res.body.error).toBe('Billing is not enabled on this server.');
      } finally {
        process.env.STRIPE_BILLING_ENABLED = saved;
      }
    });

    it('returns 404 when user has no billing account', async () => {
      // A fresh test user without a billing customer record.
      const freshEmail = `billing-portal-fresh+${TS}@example.com`;
      const freshUser = await registerAndLoginWebUser({
        firstName: 'Portal', lastName: 'Fresh', email: freshEmail, password: PASSWORD,
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

    it('creates a portal session for only the authenticated user customer', async () => {
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: 'cus_test_fake',
        emailSnapshot: EMAIL,
        livemode: false,
      });
      const res = await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      expect(res.body.url).toBe('https://billing.stripe.com/session/test');
      expect(fakeStripe.billingPortal.sessions.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          customer: 'cus_test_fake',
          return_url: 'http://localhost:19006/',
        }),
      );
    });

    it('passes the configured Stripe Portal configuration ID when present', async () => {
      const originalPortalConfig = process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID;
      process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID = 'bpc_test_config';
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: 'cus_test_fake',
        emailSnapshot: EMAIL,
        livemode: false,
      });
      try {
        await request(app)
          .post('/api/billing/portal-session')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(201);

        expect(fakeStripe.billingPortal.sessions.create).toHaveBeenLastCalledWith(
          expect.objectContaining({
            customer: 'cus_test_fake',
            return_url: 'http://localhost:19006/',
            configuration: 'bpc_test_config',
          }),
        );
      } finally {
        if (originalPortalConfig == null) delete process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID;
        else process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID = originalPortalConfig;
      }
    });

    it('rejects a client-supplied portal return URL', async () => {
      const res = await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'https://attacker.example/redirect' })
        .expect(400);
      expect(res.body.error).toBe('Request validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '(root)' }),
        ]),
      );
    });

    it('returns 400 with details when the configured portal return URL is invalid', async () => {
      const originalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL;
      process.env.STRIPE_PORTAL_RETURN_URL = 'not-a-url';
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: 'cus_test_fake',
        emailSnapshot: EMAIL,
        livemode: false,
      });
      try {
        const res = await request(app)
          .post('/api/billing/portal-session')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
        expect(res.body).toMatchObject({
          error: 'Failed to create portal session.',
        });
        expect(res.body.details).toContain('STRIPE_PORTAL_RETURN_URL must be an absolute http(s) URL');
      } finally {
        process.env.STRIPE_PORTAL_RETURN_URL = originalReturnUrl;
      }
    });

    it('returns 500 with Stripe failure details when Portal session creation fails', async () => {
      await upsertBillingCustomer({
        userId,
        stripeCustomerId: 'cus_test_fake',
        emailSnapshot: EMAIL,
        livemode: false,
      });
      fakeStripe.billingPortal.sessions.create.mockRejectedValueOnce(new Error('Stripe portal unavailable'));

      const res = await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(500);

      expect(res.body).toMatchObject({
        error: 'Failed to create portal session.',
        details: 'Stripe portal unavailable',
      });
    });
  });

  describe('POST /api/billing/refresh', () => {
    it('requires authentication', async () => {
      await request(app).post('/api/billing/refresh').expect(401);
    });

    it('retrieves current Stripe subscriptions before reconciling entitlement', async () => {
      const refreshEmail = `billing-refresh+${TS}@example.com`;
      const refreshUser = await registerAndLoginWebUser({
        firstName: 'Refresh',
        lastName: 'Billing',
        email: refreshEmail,
        password: PASSWORD,
      });
      await upsertBillingCustomer({
        userId: refreshUser.userId,
        stripeCustomerId: `cus_refresh_${TS}`,
        emailSnapshot: refreshEmail,
        livemode: false,
      });
      fakeStripe.subscriptions.list.mockResolvedValueOnce({
        data: [{
          id: `sub_refresh_${TS}`,
          status: 'active',
          livemode: false,
          customer: `cus_refresh_${TS}`,
          cancel_at_period_end: false,
          cancel_at: null,
          trial_end: null,
          ended_at: null,
          latest_invoice: null,
          metadata: { userId: refreshUser.userId, planKey: 'premium_monthly' },
          // current_period_start/end live on items.data[0] in Stripe API v2026-06-24.dahlia
          items: {
            data: [{
              price: { id: 'price_test_monthly' },
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            }],
          },
        }],
      });
      try {
        const response = await request(app)
          .post('/api/billing/refresh')
          .set('Authorization', `Bearer ${refreshUser.token}`)
          .send({})
          .expect(200);
        expect(fakeStripe.subscriptions.list).toHaveBeenCalledWith({
          customer: `cus_refresh_${TS}`,
          status: 'all',
          limit: 100,
        });
        expect(response.body.status.effectiveTier).toBe('premium');
      } finally {
        await cleanupTestUsersByEmail([refreshEmail]);
      }
    });

    it('returns 500 with details when Stripe subscription refresh fails', async () => {
      const refreshEmail = `billing-refresh-fail+${TS}@example.com`;
      const refreshUser = await registerAndLoginWebUser({
        firstName: 'Refresh',
        lastName: 'Failure',
        email: refreshEmail,
        password: PASSWORD,
      });
      await upsertBillingCustomer({
        userId: refreshUser.userId,
        stripeCustomerId: `cus_refresh_fail_${TS}`,
        emailSnapshot: refreshEmail,
        livemode: false,
      });
      fakeStripe.subscriptions.list.mockRejectedValueOnce(new Error('Stripe subscription list unavailable'));
      try {
        const res = await request(app)
          .post('/api/billing/refresh')
          .set('Authorization', `Bearer ${refreshUser.token}`)
          .send({})
          .expect(500);

        expect(res.body).toMatchObject({
          error: 'Failed to refresh billing status.',
          details: 'Stripe subscription list unavailable',
        });
      } finally {
        await cleanupTestUsersByEmail([refreshEmail]);
      }
    });
  });

  describe('billing persistence safety', () => {
    it('preserves explicit revocation across later subscription snapshots', async () => {
      const base = {
        stripeSubscriptionId: `sub_revoked_${TS}`,
        userId,
        scopeOwnerId: userId,
        stripeCustomerId: 'cus_test_fake',
        stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly' as const,
        status: 'active' as const,
        livemode: false,
        cancelAtPeriodEnd: false,
      };
      await upsertBillingSubscription(base);
      await revokeBillingSubscriptionAccess(base.stripeSubscriptionId, 'full_refund', {
        refundedAt: new Date(),
      });
      await upsertBillingSubscription({ ...base, currentPeriodEnd: new Date(Date.now() + 86_400_000) });

      const stored = await getBillingSubscriptionByStripeId(base.stripeSubscriptionId);
      expect(stored?.accessRevocationReason).toBe('full_refund');
      expect(stored?.accessRevokedAt).toBeTruthy();
      expect(stored?.refundedAt).toBeTruthy();
    });

    it('allows Stripe to retry an event after handler failure', async () => {
      const eventId = `evt_retry_${TS}`;
      const event = {
        stripeEventId: eventId,
        eventType: 'invoice.paid',
        livemode: false,
      };
      await expect(claimStripeWebhookEvent(event)).resolves.toBe(true);
      await expect(claimStripeWebhookEvent(event)).resolves.toBe(false);
      await markStripeWebhookEventFailed(eventId, 'transient failure');
      await expect(claimStripeWebhookEvent(event)).resolves.toBe(true);
    });

    it('unknown event type → 200 with received=true and handled=false, not an error', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_unknown_${TS}`,
        type: 'completely.unrecognized.event',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: { object: { id: 'obj_unknown' } },
      });
      try {
        const res = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(res.body.received).toBe(true);
        expect(res.body.handled).toBe(false);
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    });

    it('duplicate event delivery → 200 with duplicate=true, handler not invoked again', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const eventId = `evt_dupe_unit_${TS}`;
      // First delivery: unknown-type event so no handler side-effects; just claims the event.
      fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
        id: eventId,
        type: 'completely.unrecognized.for.dupe',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: { object: { id: 'obj_dupe' } },
      });
      try {
        const r1 = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(r1.body.received).toBe(true);
        expect(r1.body.duplicate).toBeFalsy();

        // Second delivery with the SAME event ID — must be detected as duplicate.
        fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
          id: eventId,
          type: 'completely.unrecognized.for.dupe',
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: { object: { id: 'obj_dupe' } },
        });
        const r2 = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(r2.body.received).toBe(true);
        expect(r2.body.duplicate).toBe(true);
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    });

    it('customer.subscription.created → subscription written to DB and tier reconciled to premium', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const subId = `sub_unit_created_${TS}`;
      const webhookEmail = `billing-webhook-created+${TS}@example.com`;
      const webhookUser = await registerAndLoginWebUser({
        firstName: 'Webhook', lastName: 'Created', email: webhookEmail, password: PASSWORD,
      });

      const mockSub = {
        id: subId,
        status: 'active',
        livemode: false,
        customer: `cus_wh_created_${TS}`,
        cancel_at_period_end: false,
        cancel_at: null,
        trial_end: null,
        ended_at: null,
        latest_invoice: null,
        metadata: { userId: webhookUser.userId, planKey: 'premium_monthly' },
        items: {
          data: [{
            price: { id: 'price_test_monthly' },
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
          }],
        },
      };

      // handleSubscriptionSnapshot calls stripe.subscriptions.retrieve to get fresh state.
      fakeStripe.subscriptions.retrieve.mockResolvedValueOnce(mockSub);
      fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_sub_created_${TS}`,
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: { object: mockSub },
      });

      try {
        const res = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(res.body.received).toBe(true);

        const stored = await getBillingSubscriptionByStripeId(subId);
        if (!stored) {
          throw new Error(
            `Expected subscription ${subId} to be in DB after customer.subscription.created. ` +
            `userId=${webhookUser.userId}. Check that userIdFromSubscription resolved from metadata.`,
          );
        }
        expect(stored.status).toBe('active');
        expect(stored.userId).toBe(webhookUser.userId);
        expect(stored.planKey).toBe('premium_monthly');
        expect(stored.cancelAtPeriodEnd).toBe(false);
        expect(stored.currentPeriodEnd).toBeTruthy();

        // Tier must be promoted to premium after snapshot reconciliation.
        const statusRes = await request(app)
          .get('/api/billing/status')
          .set('Authorization', `Bearer ${webhookUser.token}`)
          .expect(200);
        expect(statusRes.body.effectiveTier).toBe('premium');
        expect(statusRes.body.subscriptionStatus).toBe('active');
        expect(statusRes.body.plan).toBe('monthly');
        expect(statusRes.body.isBillingManaged).toBe(true);
        expect(typeof statusRes.body.currentPeriodEnd).toBe('string');
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        await cleanupTestUsersByEmail([webhookEmail]);
      }
    });

    it('invoice.payment_failed → pastDueSince recorded; invoice.paid → pastDueSince cleared', async () => {
      // Tests both the setPastDueSince guard (payment_failed) and clearPastDueSince (paid)
      // using the same subscription to verify the full past-due cycle in one test.
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const subId = `sub_past_due_cycle_${TS}`;
      const cycleEmail = `billing-past-due-cycle+${TS}@example.com`;
      const cycleUser = await registerAndLoginWebUser({
        firstName: 'PastDue', lastName: 'Cycle', email: cycleEmail, password: PASSWORD,
      });

      await upsertBillingSubscription({
        stripeSubscriptionId: subId,
        userId: cycleUser.userId,
        scopeOwnerId: cycleUser.userId,
        stripeCustomerId: `cus_pd_cycle_${TS}`,
        stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly',
        status: 'active',
        livemode: false,
        cancelAtPeriodEnd: false,
      });

      const mockSubForSnapshot = {
        id: subId,
        status: 'past_due',
        livemode: false,
        customer: `cus_pd_cycle_${TS}`,
        cancel_at_period_end: false,
        cancel_at: null,
        trial_end: null,
        ended_at: null,
        latest_invoice: null,
        metadata: { userId: cycleUser.userId, planKey: 'premium_monthly' },
        items: {
          data: [{
            price: { id: 'price_test_monthly' },
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
          }],
        },
      };

      // --- invoice.payment_failed ---
      // Handler: setPastDueSince → handleSubscriptionSnapshot (retrieve) → scheduleNextBillingGraceExpiry
      fakeStripe.subscriptions.retrieve.mockResolvedValueOnce(mockSubForSnapshot);
      fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_inv_failed_${TS}`,
        type: 'invoice.payment_failed',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
          object: {
            id: `in_failed_${TS}`,
            object: 'invoice',
            parent: { subscription_details: { subscription: subId } },
            status: 'open',
          },
        },
      });

      try {
        const failedRes = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(failedRes.body.received).toBe(true);

        const afterFailed = await getBillingSubscriptionByStripeId(subId);
        if (!afterFailed) throw new Error(`Expected subscription ${subId} in DB after invoice.payment_failed`);
        expect(afterFailed.pastDueSince).toBeTruthy();

        // --- invoice.paid ---
        // Handler: clearPastDueSince → handleSubscriptionSnapshot (retrieve) → scheduleNextBillingGraceExpiry
        const mockSubActive = { ...mockSubForSnapshot, status: 'active' };
        fakeStripe.subscriptions.retrieve.mockResolvedValueOnce(mockSubActive);
        fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
          id: `evt_inv_paid_${TS}`,
          type: 'invoice.paid',
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: {
            object: {
              id: `in_paid_${TS}`,
              object: 'invoice',
              parent: { subscription_details: { subscription: subId } },
              status: 'paid',
            },
          },
        });

        const paidRes = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(paidRes.body.received).toBe(true);

        const afterPaid = await getBillingSubscriptionByStripeId(subId);
        if (!afterPaid) throw new Error(`Expected subscription ${subId} in DB after invoice.paid`);
        expect(afterPaid.pastDueSince).toBeNull();
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        await cleanupTestUsersByEmail([cycleEmail]);
      }
    });

    it('revokes Premium after a verified full-refund webhook', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const refundEmail = `billing-refund-route+${TS}@example.com`;
      const refundUser = await registerAndLoginWebUser({
        firstName: 'Refund',
        lastName: 'Route',
        email: refundEmail,
        password: PASSWORD,
      });
      const eventId = `evt_refund_${TS}`;
      const subscriptionId = `sub_refund_route_${TS}`;
      const customerId = `cus_refund_route_${TS}`;
      await upsertBillingCustomer({
        userId: refundUser.userId,
        stripeCustomerId: customerId,
        emailSnapshot: refundEmail,
        livemode: false,
      });
      await upsertBillingSubscription({
        stripeSubscriptionId: subscriptionId,
        userId: refundUser.userId,
        scopeOwnerId: refundUser.userId,
        stripeCustomerId: customerId,
        stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly',
        status: 'active',
        livemode: false,
        cancelAtPeriodEnd: false,
      });
      fakeStripe.webhooks.constructEvent.mockReturnValue({
        id: eventId,
        type: 'charge.refunded',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
          object: {
            id: 'ch_full_refund',
            customer: customerId,
            amount: 500,
            amount_refunded: 500,
          },
        },
      });

      try {
        await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_signature')
          .send(Buffer.from('{}'))
          .expect(200);

        const stored = await getBillingSubscriptionByStripeId(subscriptionId);
        expect(stored?.accessRevocationReason).toBe('full_refund');
        expect(stored?.refundedAt).toBeTruthy();
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        await cleanupTestUsersByEmail([refundEmail]);
      }
    });

    it('refund.failed restores Premium access when the bank rejects the refund — uses same handler as refund.updated', async () => {
      // refund.failed fires when Stripe cannot complete a refund (e.g. bank rejects it),
      // returning funds to the merchant.  It shares handleRefundUpdated with refund.updated.
      // After refund.failed, charge.amount_refunded drops back to 0, so the full-refund
      // revocation must be lifted and Premium access restored.
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const rfEmail = `billing-refund-failed+${TS}@example.com`;
      const rfUser = await registerAndLoginWebUser({
        firstName: 'Refund', lastName: 'BankFailed', email: rfEmail, password: PASSWORD,
      });
      const rfSubId = `sub_rf_${TS}`;
      const rfCustId = `cus_rf_${TS}`;

      await upsertBillingCustomer({ userId: rfUser.userId, stripeCustomerId: rfCustId, emailSnapshot: rfEmail, livemode: false });
      await upsertBillingSubscription({
        stripeSubscriptionId: rfSubId, userId: rfUser.userId, scopeOwnerId: rfUser.userId,
        stripeCustomerId: rfCustId, stripePriceId: 'price_test_monthly',
        planKey: 'premium_monthly', status: 'active', livemode: false, cancelAtPeriodEnd: false,
      });
      // Pre-set a full-refund revocation so the handler has something to clear.
      await revokeBillingSubscriptionAccess(rfSubId, 'full_refund', { refundedAt: new Date() });

      // Stripe tells us the refund failed: charge now shows amount_refunded = 0.
      fakeStripe.charges.retrieve.mockResolvedValueOnce({
        id: `ch_rf_${TS}`, customer: rfCustId, amount: 500, amount_refunded: 0,
      });
      fakeStripe.webhooks.constructEvent.mockReturnValueOnce({
        id: `evt_refund_failed_${TS}`,
        type: 'refund.failed',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: { object: { id: `re_rf_${TS}`, charge: `ch_rf_${TS}`, status: 'failed' } },
      });

      try {
        const res = await request(app)
          .post('/api/billing/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 'test_sig')
          .send(Buffer.from('{}'))
          .expect(200);
        expect(res.body.received).toBe(true);

        const stored = await getBillingSubscriptionByStripeId(rfSubId);
        if (!stored) throw new Error(`Expected subscription ${rfSubId} in DB after refund.failed`);
        expect(stored.accessRevokedAt).toBeNull();
        expect(stored.accessRevocationReason).toBeNull();
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        await cleanupTestUsersByEmail([rfEmail]);
      }
    });
  });
});

describe('Stripe webhook route', () => {
  it('returns 503 when billing is disabled', async () => {
    const saved = process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_BILLING_ENABLED = 'false';
    try {
      const res = await request(app)
        .post('/api/billing/webhooks/stripe')
        .send({})
        .expect(503);
      expect(res.body.error).toBe('Billing is not enabled.');
    } finally {
      process.env.STRIPE_BILLING_ENABLED = saved;
    }
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    try {
      const res = await request(app)
        .post('/api/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(400);
      expect(res.body.error).toBe('Missing Stripe-Signature header.');
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it('returns 500 when webhook secret is not configured', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=123,v1=test')
      .send(Buffer.from('{}'))
      .expect(500);
    expect(res.body.error).toBe('Webhook secret not configured.');
  });

  it('returns 400 when signature verification fails', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const badSig = 'bad_signature';

    const fakeStripeLocal = makeFakeStripe({
      webhooks: {
        constructEvent: jest.fn().mockImplementation(() => {
          throw new Error('Webhook Error: No signatures found matching the expected signature for payload.');
        }),
      },
    });
    setStripeClientForTesting(fakeStripeLocal as any);

    try {
      const res = await request(app)
        .post('/api/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', badSig)
        .send(Buffer.from('{}'))
        .expect(400);
      expect(res.body.error).toBe('Webhook signature verification failed.');
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      setStripeClientForTesting(null);
    }
  });
});
