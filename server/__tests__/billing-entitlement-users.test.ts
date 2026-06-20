import {
  closePool,
  getCurrentUserTier,
  initDb,
  setUserRole,
  setUserTier,
} from '../src/db';
import { reconcileUserTierFromBilling } from '../src/billing/subscriptionEntitlementService';
import type { BillingSubscription } from '../src/types';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const PASSWORD = 'BillingTier1!';
const emails = {
  billing: `billing-tier+${TS}@example.com`,
  manual: `billing-manual+${TS}@example.com`,
  admin: `billing-admin+${TS}@example.com`,
};

const makeSubscription = (
  userId: string,
  overrides: Partial<BillingSubscription> = {},
): BillingSubscription => ({
  id: `local_${userId}`,
  stripeSubscriptionId: `sub_${userId}`,
  userId,
  subscriptionScope: 'individual',
  scopeOwnerId: userId,
  stripeCustomerId: `cus_${userId}`,
  stripePriceId: 'price_test_monthly',
  planKey: 'premium_monthly',
  status: 'active',
  livemode: false,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  trialEnd: null,
  endedAt: null,
  latestInvoiceId: null,
  pastDueSince: null,
  accessRevokedAt: null,
  accessRevocationReason: null,
  disputeId: null,
  refundedAt: null,
  lastStripeEventCreated: null,
  lastSyncedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('billing entitlement reconciliation with users', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail(Object.values(emails));
    await closePool();
  });

  it('upgrades and later downgrades a billing-managed test user', async () => {
    const user = await registerAndLoginWebUser({
      firstName: 'Billing',
      lastName: 'Managed',
      email: emails.billing,
      password: PASSWORD,
    });
    const active = makeSubscription(user.userId);

    const upgraded = await reconcileUserTierFromBilling(user.userId, [active], {
      reason: 'test activation',
      stripeSubscriptionId: active.stripeSubscriptionId,
    });
    expect(upgraded).toMatchObject({ changed: true, from: 'free', to: 'premium' });
    expect((await getCurrentUserTier(user.userId))?.source).toBe('billing');

    const downgraded = await reconcileUserTierFromBilling(
      user.userId,
      [{ ...active, status: 'canceled' }],
      { reason: 'test cancellation', stripeSubscriptionId: active.stripeSubscriptionId },
    );
    expect(downgraded).toMatchObject({ changed: true, from: 'premium', to: 'free' });
    expect((await getCurrentUserTier(user.userId))?.source).toBe('billing');
  });

  it('does not overwrite a manual Premium grant', async () => {
    const user = await registerAndLoginWebUser({
      firstName: 'Manual',
      lastName: 'Grant',
      email: emails.manual,
      password: PASSWORD,
    });
    await setUserTier(user.userId, 'premium', 'admin_override', null, 'manual grant');

    const result = await reconcileUserTierFromBilling(user.userId, [], {
      reason: 'no Stripe subscription',
    });
    expect(result.skipped).toBe('admin_override');
    expect((await getCurrentUserTier(user.userId))?.tierKey).toBe('premium');
  });

  it('does not alter an administrator tier', async () => {
    const user = await registerAndLoginWebUser({
      firstName: 'Admin',
      lastName: 'Billing',
      email: emails.admin,
      password: PASSWORD,
    });
    await setUserRole(user.userId, 'admin');
    await setUserTier(user.userId, 'pro', 'admin', null, 'admin role');

    const result = await reconcileUserTierFromBilling(user.userId, [], {
      reason: 'no Stripe subscription',
    });
    expect(result.skipped).toBe('admin_role');
    expect((await getCurrentUserTier(user.userId))?.tierKey).toBe('pro');
  });
});
