/// <reference types="jest" />
/// <reference types="node" />
import {
  isSubscriptionPremiumEligible,
  computeBillingEntitlementDecision,
} from '../src/billing/subscriptionEntitlementService';
import type { BillingSubscription } from '../src/types';

const makeSub = (overrides: Partial<BillingSubscription> = {}): BillingSubscription => ({
  id: 'local-1',
  stripeSubscriptionId: 'sub_test_123',
  userId: 'user-1',
  subscriptionScope: 'individual',
  scopeOwnerId: 'user-1',
  stripeCustomerId: 'cus_test_123',
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

describe('isSubscriptionPremiumEligible', () => {
  it('grants access for active subscription', () => {
    expect(isSubscriptionPremiumEligible(makeSub({ status: 'active' }))).toBe(true);
  });

  it('grants access for trialing subscription', () => {
    expect(isSubscriptionPremiumEligible(makeSub({ status: 'trialing' }))).toBe(true);
  });

  it('revokes access for canceled subscription', () => {
    expect(isSubscriptionPremiumEligible(makeSub({ status: 'canceled' }))).toBe(false);
  });

  it('keeps access until the grace deadline even if Stripe cancels during dunning', () => {
    const recentlyPastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isSubscriptionPremiumEligible(makeSub({ status: 'canceled', pastDueSince: recentlyPastDue })),
    ).toBe(true);
  });

  it('revokes access for incomplete subscription', () => {
    expect(isSubscriptionPremiumEligible(makeSub({ status: 'incomplete' }))).toBe(false);
  });

  it('revokes access for unpaid subscription', () => {
    expect(isSubscriptionPremiumEligible(makeSub({ status: 'unpaid' }))).toBe(false);
  });

  it.each(['paused', 'incomplete_expired'] as const)('revokes access for %s subscription', (status) => {
    expect(isSubscriptionPremiumEligible(makeSub({ status }))).toBe(false);
  });

  it('grants access for past_due within 14-day grace period', () => {
    const recentlyPastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isSubscriptionPremiumEligible(makeSub({ status: 'past_due', pastDueSince: recentlyPastDue })),
    ).toBe(true);
  });

  it('revokes access for past_due after 14-day grace period', () => {
    const longPastDue = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isSubscriptionPremiumEligible(makeSub({ status: 'past_due', pastDueSince: longPastDue })),
    ).toBe(false);
  });

  it('uses a plan-specific grace period', () => {
    const pastDueForEightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const sub = makeSub({ status: 'past_due', pastDueSince: pastDueForEightDays });
    expect(isSubscriptionPremiumEligible(sub, 7)).toBe(false);
    expect(isSubscriptionPremiumEligible(sub, 14)).toBe(true);
  });

  it('grants access for past_due with no pastDueSince (clock not started yet)', () => {
    expect(
      isSubscriptionPremiumEligible(makeSub({ status: 'past_due', pastDueSince: null })),
    ).toBe(true);
  });

  it('revokes access when access_revoked_at is set, even for active subscription', () => {
    expect(
      isSubscriptionPremiumEligible(
        makeSub({ status: 'active', accessRevokedAt: new Date().toISOString() }),
      ),
    ).toBe(false);
  });

  it('revokes access when access_revoked_at is set for trialing subscription', () => {
    expect(
      isSubscriptionPremiumEligible(
        makeSub({ status: 'trialing', accessRevokedAt: new Date().toISOString() }),
      ),
    ).toBe(false);
  });
});

describe('computeBillingEntitlementDecision', () => {
  it('returns shouldHavePremium=true when there is an active subscription', () => {
    const result = computeBillingEntitlementDecision([makeSub({ status: 'active' })]);
    expect(result.shouldHavePremium).toBe(true);
    expect(result.eligibleSubscriptionId).toBe('sub_test_123');
  });

  it('returns shouldHavePremium=false when there are no subscriptions', () => {
    const result = computeBillingEntitlementDecision([]);
    expect(result.shouldHavePremium).toBe(false);
    expect(result.eligibleSubscriptionId).toBeNull();
  });

  it('returns shouldHavePremium=false when all subscriptions are canceled', () => {
    const result = computeBillingEntitlementDecision([makeSub({ status: 'canceled' })]);
    expect(result.shouldHavePremium).toBe(false);
  });

  it('uses the first eligible subscription when multiple exist', () => {
    const active = makeSub({ stripeSubscriptionId: 'sub_active', status: 'active' });
    const canceled = makeSub({ stripeSubscriptionId: 'sub_canceled', status: 'canceled' });
    const result = computeBillingEntitlementDecision([active, canceled]);
    expect(result.shouldHavePremium).toBe(true);
    expect(result.eligibleSubscriptionId).toBe('sub_active');
  });

  it('handles past_due within grace period as eligible', () => {
    const recentPastDue = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeBillingEntitlementDecision([
      makeSub({ status: 'past_due', pastDueSince: recentPastDue }),
    ]);
    expect(result.shouldHavePremium).toBe(true);
  });

  it('uses configured grace days for each plan', () => {
    const pastDueForEightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = computeBillingEntitlementDecision(
      [makeSub({ status: 'past_due', pastDueSince: pastDueForEightDays })],
      { premium_monthly: 7 },
    );
    expect(result.shouldHavePremium).toBe(false);
  });

  it('treats full refund (access_revoked_at set) as ineligible even for active status', () => {
    const result = computeBillingEntitlementDecision([
      makeSub({ status: 'active', accessRevokedAt: new Date().toISOString() }),
    ]);
    expect(result.shouldHavePremium).toBe(false);
  });
});
