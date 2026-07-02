/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import {
  closePool,
  getBillingPlanConfig,
  initDb,
  listBillingPriceHistory,
  upsertBillingPlanConfig,
  upsertBillingSubscription,
} from '../src/db';
import type { BillingPlanConfig } from '../src/types';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import {
  cleanupTestUsersByEmail,
  makeAdminUser,
  registerAndLoginWebUser,
} from './helpers';

const TS = Date.now();
const PASSWORD = 'AdminBilling1!';
const ADMIN_EMAIL = `admin-billing+${TS}@example.com`;
const USER_EMAIL = `admin-billing-user+${TS}@example.com`;

describe('Admin billing routes', () => {
  let adminToken: string;
  let adminId: string;
  let userToken: string;
  let userId: string;
  let fakeStripe: any;
  let originalMonthlyConfig: BillingPlanConfig | null;
  let originalAnnualConfig: BillingPlanConfig | null;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_PREMIUM_PRODUCT_ID = 'prod_test_premium';
    await initDb();
    originalMonthlyConfig = await getBillingPlanConfig('premium_monthly');
    originalAnnualConfig = await getBillingPlanConfig('premium_annual');

    const admin = await makeAdminUser({
      firstName: 'Admin',
      lastName: 'Billing',
      email: ADMIN_EMAIL,
      password: PASSWORD,
    });
    adminToken = admin.token;
    adminId = admin.userId;
    const user = await registerAndLoginWebUser({
      firstName: 'Regular',
      lastName: 'Billing',
      email: USER_EMAIL,
      password: PASSWORD,
    });
    userToken = user.token;
    userId = user.userId;

    fakeStripe = {
      prices: {
        create: jest.fn().mockResolvedValue({
          id: `price_admin_${TS}`,
          livemode: false,
        }),
      },
      subscriptions: {
        retrieve: jest.fn(),
      },
    };
    setStripeClientForTesting(fakeStripe);
  });

  afterAll(async () => {
    if (originalMonthlyConfig) {
      await upsertBillingPlanConfig({ ...originalMonthlyConfig, planKey: 'premium_monthly', updatedBy: null }).catch(() => undefined);
    }
    if (originalAnnualConfig) {
      await upsertBillingPlanConfig({ ...originalAnnualConfig, planKey: 'premium_annual', updatedBy: null }).catch(() => undefined);
    }
    setStripeClientForTesting(null);
    delete process.env.STRIPE_BILLING_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PREMIUM_PRODUCT_ID;
    await cleanupTestUsersByEmail([ADMIN_EMAIL, USER_EMAIL]);
    await closePool();
  });

  it('requires authentication and an admin role', async () => {
    await request(app)
      .get('/api/admin/billing/config')
      .expect(401);
    const forbidden = await request(app)
      .get('/api/admin/billing/config')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(forbidden.body.error).toBe('Admin access required');
  });

  it('returns billing configuration to an administrator', async () => {
    const res = await request(app)
      .get('/api/admin/billing/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.billingEnabled).toBe(true);
    expect(res.body.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planKey: 'premium_monthly' }),
        expect.objectContaining({ planKey: 'premium_annual' }),
      ]),
    );
  });

  it('validates config updates and persists allowed fields', async () => {
    const invalidPlan = await request(app)
      .patch('/api/admin/billing/config/not-a-plan')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ trialDays: 10 })
      .expect(400);
    expect(invalidPlan.body.error).toBe('planKey must be premium_monthly or premium_annual.');

    const emptyUpdate = await request(app)
      .patch('/api/admin/billing/config/premium_monthly')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
    expect(emptyUpdate.body.error).toBe('No fields provided to update.');

    const invalidPayload = await request(app)
      .patch('/api/admin/billing/config/premium_monthly')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ trialDays: -1 })
      .expect(400);
    expect(invalidPayload.body.error).toBe('Request validation failed');
    expect(invalidPayload.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'trialDays' }),
      ]),
    );

    await request(app)
      .patch('/api/admin/billing/config/premium_monthly')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ trialDays: 10, pastDueGraceDays: 21, promotionCodesEnabled: false })
      .expect(200);

    const config = await getBillingPlanConfig('premium_monthly');
    expect(config).toMatchObject({
      trialDays: 10,
      pastDueGraceDays: 21,
      promotionCodesEnabled: false,
      updatedBy: adminId,
    });
  });

  it('publishes an immutable Stripe Price and records its history', async () => {
    const res = await request(app)
      .post('/api/admin/billing/plans/premium_annual/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unitAmountCents: 3900, currency: 'usd' })
      .expect(201);

    expect(fakeStripe.prices.create).toHaveBeenCalledWith({
      product: 'prod_test_premium',
      unit_amount: 3900,
      currency: 'usd',
      recurring: { interval: 'year' },
      tax_behavior: 'exclusive',
      lookup_key: 'wanderbunnies_premium_annual',
      transfer_lookup_key: true,
      metadata: { planKey: 'premium_annual', createdBy: adminId },
    });
    expect(res.body.stripePriceId).toBe(`price_admin_${TS}`);
    expect(await listBillingPriceHistory('premium_annual')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stripePriceId: `price_admin_${TS}`,
          unitAmountCents: 3900,
          activeForNewCheckout: true,
        }),
      ]),
    );
    expect(await getBillingPlanConfig('premium_annual')).toMatchObject({
      activeStripePriceId: `price_admin_${TS}`,
      unitAmountCents: 3900,
    });
  });

  it('returns billing price history to an administrator', async () => {
    const res = await request(app)
      .get('/api/admin/billing/prices')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.prices)).toBe(true);
  });

  it('validates price publishing errors with detailed bodies', async () => {
    const invalidPlan = await request(app)
      .post('/api/admin/billing/plans/not-a-plan/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unitAmountCents: 3900, currency: 'usd' })
      .expect(400);
    expect(invalidPlan.body.error).toBe('planKey must be premium_monthly or premium_annual.');

    const invalidPayload = await request(app)
      .post('/api/admin/billing/plans/premium_monthly/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unitAmountCents: 0, currency: 'usd' })
      .expect(400);
    expect(invalidPayload.body.error).toBe('Request validation failed');
    expect(invalidPayload.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'unitAmountCents' }),
      ]),
    );

    const originalProductId = process.env.STRIPE_PREMIUM_PRODUCT_ID;
    delete process.env.STRIPE_PREMIUM_PRODUCT_ID;
    try {
      const missingProduct = await request(app)
        .post('/api/admin/billing/plans/premium_monthly/price')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitAmountCents: 500, currency: 'usd' })
        .expect(503);
      expect(missingProduct.body.error).toBe('STRIPE_PREMIUM_PRODUCT_ID is not configured.');
    } finally {
      process.env.STRIPE_PREMIUM_PRODUCT_ID = originalProductId;
    }

    fakeStripe.prices.create.mockRejectedValueOnce(new Error('Stripe price create unavailable'));
    const stripeFailure = await request(app)
      .post('/api/admin/billing/plans/premium_monthly/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ unitAmountCents: 500, currency: 'usd' })
      .expect(500);
    expect(stripeFailure.body).toMatchObject({
      error: 'Failed to publish new price.',
      details: 'Stripe price create unavailable',
    });
  });

  it('manually reconciles a target user from stored Stripe state', async () => {
    await upsertBillingSubscription({
      stripeSubscriptionId: `sub_admin_reconcile_${TS}`,
      userId,
      scopeOwnerId: userId,
      stripeCustomerId: `cus_admin_reconcile_${TS}`,
      stripePriceId: 'price_test_monthly',
      planKey: 'premium_monthly',
      status: 'active',
      livemode: false,
      cancelAtPeriodEnd: false,
    });

    const res = await request(app)
      .post(`/api/admin/billing/reconcile/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.result).toMatchObject({ to: 'premium' });
    expect(res.body.subscriptions).toHaveLength(1);
  });

  it('returns 503 when admin reconciliation batch is requested while billing is disabled', async () => {
    const saved = process.env.STRIPE_BILLING_ENABLED;
    process.env.STRIPE_BILLING_ENABLED = 'false';
    try {
      const res = await request(app)
        .post('/api/admin/billing/reconcile-batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(503);
      expect(res.body.error).toBe('Billing is not enabled.');
    } finally {
      process.env.STRIPE_BILLING_ENABLED = saved;
    }
  });

  it('runs an admin reconciliation batch and returns a numeric summary', async () => {
    const res = await request(app)
      .post('/api/admin/billing/reconcile-batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ olderThanMinutes: 60, limit: 5 })
      .expect(200);

    expect(res.body).toMatchObject({
      processed: expect.any(Number),
      repaired: expect.any(Number),
      tierChanged: expect.any(Number),
      errors: expect.any(Number),
      orphaned: expect.any(Number),
    });
  });
});
