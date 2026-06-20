import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  upsertBillingPlanConfig,
  upsertBillingSubscription,
  getBillingSubscriptionByStripeId,
  revokeBillingSubscriptionAccess,
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  upsertBillingCustomer,
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
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_test',
      status: 'active',
      livemode: false,
      customer: 'cus_test_fake',
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      trial_end: null,
      ended_at: null,
      latest_invoice: null,
      metadata: { userId: '', planKey: 'premium_monthly' },
      items: { data: [{ price: { id: 'price_test_monthly' } }] },
    }),
    cancel: jest.fn().mockResolvedValue({}),
  },
  invoices: {
    retrieve: jest.fn().mockResolvedValue({ id: 'in_test', subscription: 'sub_test' }),
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
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'http://localhost:19006/billing/success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'http://localhost:19006/billing/cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'http://localhost:19006/account';

    await initDb();
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

    it('returns billing status for authenticated user', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('effectiveTier');
      expect(res.body).toHaveProperty('checkoutAvailable');
      expect(res.body).toHaveProperty('portalAvailable');
      expect(res.body.effectiveTier).toBe('free');
      expect(res.body.checkoutAvailable).toBe(true);
      expect(res.body.portalAvailable).toBe(false);
    });
  });

  describe('GET /api/billing/plans', () => {
    it('requires authentication', async () => {
      await request(app).get('/api/billing/plans').expect(401);
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
      expect(monthly.trialDays).toBe(14);
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

    it('rejects invalid plan key', async () => {
      await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'hacker_free', idempotencyKey: 'test-key-1', clientPlatform: 'web' })
        .expect(400);
    });

    it('rejects missing idempotency key', async () => {
      await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', clientPlatform: 'web' })
        .expect(400);
    });

    it('rejects native checkout requests', async () => {
      await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_monthly', idempotencyKey: 'native-test', clientPlatform: 'ios' })
        .expect(400);
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
      expect(call.client_reference_id).toBe(userId);
      expect(call.subscription_data.trial_period_days).toBe(14);
      expect(call.automatic_tax.enabled).toBe(true);
      expect(call.allow_promotion_codes).toBe(true);
    });

    it('uses admin-configured price, trial, tax, and promotion settings', async () => {
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

      await request(app)
        .post('/api/billing/checkout-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ planKey: 'premium_annual', idempotencyKey: `admin-config-${TS}`, clientPlatform: 'web' })
        .expect(201);

      const call = fakeStripe.checkout.sessions.create.mock.calls.at(-1)[0];
      expect(call.line_items[0].price).toBe('price_admin_annual');
      expect(call.subscription_data.trial_period_days).toBe(7);
      expect(call.automatic_tax.enabled).toBe(false);
      expect(call.allow_promotion_codes).toBe(false);
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
        expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledTimes(callsBefore);
      } finally {
        await cleanupTestUsersByEmail([subscribedEmail]);
      }
    });

    it('returns 500 when the selected plan is disabled', async () => {
      await upsertBillingPlanConfig({
        planKey: 'premium_monthly',
        isCheckoutEnabled: false,
        updatedBy: userId,
      });
      try {
        await request(app)
          .post('/api/billing/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({
            planKey: 'premium_monthly',
            idempotencyKey: `disabled-${TS}`,
            clientPlatform: 'web',
          })
          .expect(500);
      } finally {
        await upsertBillingPlanConfig({
          planKey: 'premium_monthly',
          isCheckoutEnabled: true,
          updatedBy: userId,
        });
      }
    });
  });

  describe('POST /api/billing/portal-session', () => {
    it('requires authentication', async () => {
      await request(app).post('/api/billing/portal-session').expect(401);
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
          return_url: 'http://localhost:19006/account',
        }),
      );
    });

    it('rejects a client-supplied portal return URL', async () => {
      await request(app)
        .post('/api/billing/portal-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ returnUrl: 'https://attacker.example/redirect' })
        .expect(400);
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

    it('revokes Premium after a verified full-refund webhook', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const eventId = `evt_refund_${TS}`;
      fakeStripe.webhooks.constructEvent.mockReturnValue({
        id: eventId,
        type: 'charge.refunded',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
          object: {
            id: 'ch_full_refund',
            invoice: 'in_test',
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

        const stored = await getBillingSubscriptionByStripeId('sub_test');
        expect(stored?.accessRevocationReason).toBe('full_refund');
        expect(stored?.refundedAt).toBeTruthy();
      } finally {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    });
  });
});

describe('Stripe webhook route', () => {
  it('returns 400 when billing is disabled', async () => {
    const saved = process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_BILLING_ENABLED = 'false';
    try {
      await request(app)
        .post('/api/billing/webhooks/stripe')
        .send({})
        .expect(503);
    } finally {
      process.env.STRIPE_BILLING_ENABLED = saved;
    }
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    try {
      await request(app)
        .post('/api/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
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
      await request(app)
        .post('/api/billing/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', badSig)
        .send(Buffer.from('{}'))
        .expect(400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      setStripeClientForTesting(null);
    }
  });
});
