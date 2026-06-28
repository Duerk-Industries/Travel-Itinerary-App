/// <reference types="jest" />
/// <reference types="node" />
import {
  closePool,
  getCurrentUserTier,
  initDb,
  upsertBillingSubscription,
} from '../src/db';
import { reconcileUserTierFromBillingById } from '../src/billing/subscriptionEntitlementService';
import { reconcileSubscription } from '../src/billing/subscriptionReconciliationService';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const EMAIL = `billing-reconcile+${TS}@example.com`;
const PASSWORD = 'BillingReconcile1!';

describe('billing subscription reconciliation', () => {
  let userId: string;

  beforeAll(async () => {
    await initDb();
    userId = (await registerAndLoginWebUser({
      firstName: 'Billing',
      lastName: 'Reconcile',
      email: EMAIL,
      password: PASSWORD,
    })).userId;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  it('does not downgrade a user when the repaired subscription is canceled but another is active', async () => {
    const canceledId = `sub_reconcile_canceled_${TS}`;
    const activeId = `sub_reconcile_active_${TS}`;
    const common = {
      userId,
      scopeOwnerId: userId,
      stripeCustomerId: `cus_reconcile_${TS}`,
      stripePriceId: 'price_test_monthly',
      planKey: 'premium_monthly' as const,
      livemode: false,
      cancelAtPeriodEnd: false,
    };
    const canceledLocal = await upsertBillingSubscription({
      ...common,
      stripeSubscriptionId: canceledId,
      status: 'active',
    });
    await upsertBillingSubscription({
      ...common,
      stripeSubscriptionId: activeId,
      status: 'active',
    });
    await reconcileUserTierFromBillingById(userId, { reason: 'test setup' });
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');

    const stripe = {
      subscriptions: {
        retrieve: jest.fn().mockResolvedValue({
          id: canceledId,
          status: 'canceled',
          livemode: false,
          customer: common.stripeCustomerId,
          cancel_at_period_end: false,
          cancel_at: null,
          trial_end: null,
          ended_at: Math.floor(Date.now() / 1000),
          latest_invoice: null,
          metadata: { userId, planKey: 'premium_monthly' },
          // current_period_start/end belong on items.data[0] in Stripe API v2026-06-24.dahlia
          items: {
            data: [{
              price: { id: common.stripePriceId },
              current_period_start: Math.floor(Date.now() / 1000) - 100,
              current_period_end: Math.floor(Date.now() / 1000),
            }],
          },
        }),
      },
    };

    const result = await reconcileSubscription(canceledLocal, stripe as any);
    expect(result).toMatchObject({ repaired: true, tierChanged: false, orphaned: false });
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });
});
