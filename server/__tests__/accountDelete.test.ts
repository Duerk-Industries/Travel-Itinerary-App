/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  findUserByEmail,
  listGroupsForUser,
  getBillingCustomerByUserId,
  getBillingSubscriptionByStripeId,
  getBillingTrialUsageByEmail,
  markBillingTrialUsed,
  upsertBillingCustomer,
  upsertBillingSubscription,
} from '../src/db';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import {
  cleanupTestUsersByEmail,
  registerAndLoginWebUser,
  loginWebUser,
} from './helpers';

describe('DELETE /api/account', () => {
  const EMAIL = 'account-delete-test@example.com';
  const PASSWORD = 'deletemetest';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  afterEach(async () => {
    setStripeClientForTesting(null);
    process.env.STRIPE_BILLING_ENABLED = 'false';
    await cleanupTestUsersByEmail([EMAIL]);
  });

  it('returns 401 without an auth token', async () => {
    await request(app).delete('/api/account').expect(401);
  });

  it('deletes the authenticated user and returns 204', async () => {
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });

    // Sanity: user exists and owns the default group
    const beforeUser = await findUserByEmail(EMAIL);
    expect(beforeUser?.id).toBe(userId);
    const groupsBefore = await listGroupsForUser(userId);
    expect(groupsBefore.length).toBeGreaterThan(0);

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const afterUser = await findUserByEmail(EMAIL);
    expect(afterUser).toBeFalsy();
  });

  it('prevents re-login after the account is deleted', async () => {
    await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });
    const login = await loginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });
    const token = login.body.token as string;

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app)
      .post('/api/web-auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401);
  });

  it('returns 401 when the same token is replayed after deletion', async () => {
    const { token } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // With the user removed, the account-profile route should reject the stale token.
    await request(app)
      .get('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('cancels Stripe subscriptions and removes billing records before deleting the user', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    const cancel = jest.fn().mockResolvedValue({ status: 'canceled' });
    setStripeClientForTesting({ subscriptions: { cancel } } as any);
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Billing',
      email: EMAIL,
      password: PASSWORD,
    });
    const subscriptionId = `sub_delete_${Date.now()}`;
    await upsertBillingCustomer({
      userId,
      stripeCustomerId: `cus_delete_${Date.now()}`,
      emailSnapshot: EMAIL,
      livemode: false,
    });
    await upsertBillingSubscription({
      stripeSubscriptionId: subscriptionId,
      userId,
      scopeOwnerId: userId,
      stripeCustomerId: `cus_delete_${Date.now()}`,
      stripePriceId: 'price_test_monthly',
      planKey: 'premium_monthly',
      status: 'active',
      livemode: false,
      cancelAtPeriodEnd: false,
    });

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(cancel).toHaveBeenCalledWith(subscriptionId);
    expect(await getBillingCustomerByUserId(userId)).toBeNull();
    expect(await getBillingSubscriptionByStripeId(subscriptionId)).toBeNull();
  });

  it('preserves premium trial usage when an account is deleted', async () => {
    const trialEmail = `account-delete-trial-${Date.now()}@example.com`;
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Trial',
      email: trialEmail,
      password: PASSWORD,
    });

    await markBillingTrialUsed({
      emailNormalized: trialEmail.toLowerCase(),
      userId,
      stripeCustomerId: `cus_delete_trial_${Date.now()}`,
      stripeSubscriptionId: `sub_delete_trial_${Date.now()}`,
      trialUsedAt: new Date(Date.now() - 86_400_000),
    });

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(await findUserByEmail(trialEmail)).toBeFalsy();
    const usage = await getBillingTrialUsageByEmail(trialEmail.toLowerCase());
    expect(usage).toMatchObject({
      emailNormalized: trialEmail.toLowerCase(),
    });
    expect(usage?.trialUsedAt).toBeTruthy();
  });

  it('does not delete the account when Stripe cancellation fails', async () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    setStripeClientForTesting({
      subscriptions: { cancel: jest.fn().mockRejectedValue(new Error('Stripe unavailable')) },
    } as any);
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Blocked',
      email: EMAIL,
      password: PASSWORD,
    });
    const subscriptionId = `sub_delete_fail_${Date.now()}`;
    await upsertBillingSubscription({
      stripeSubscriptionId: subscriptionId,
      userId,
      scopeOwnerId: userId,
      stripeCustomerId: `cus_delete_fail_${Date.now()}`,
      stripePriceId: 'price_test_monthly',
      planKey: 'premium_monthly',
      status: 'active',
      livemode: false,
      cancelAtPeriodEnd: false,
    });

    const res = await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(res.body.error).toBe(`Unable to cancel Stripe subscriptions: ${subscriptionId}`);
    expect((await findUserByEmail(EMAIL))?.id).toBe(userId);
  });
});
