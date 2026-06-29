/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import {
  claimBillingCheckout,
  closePool,
  getBillingSubscriptionByStripeId,
  listBillingNotificationsForUser,
  getBillingTrialUsageByEmail,
  getCurrentUserTier,
  getStripeWebhookEvent,
  initDb,
  upsertBillingCustomer,
  upsertBillingPlanConfig,
} from '../src/db';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const EMAIL = `billing-webhooks+${TS}@example.com`;
const PASSWORD = 'BillingWebhook1!';
const SUBSCRIPTION_ID = `sub_workflow_${TS}`;

const subscription: any = {
  id: SUBSCRIPTION_ID,
  status: 'active',
  livemode: false,
  customer: `cus_workflow_${TS}`,
  cancel_at_period_end: false,
  cancel_at: null,
  trial_end: null,
  ended_at: null,
  latest_invoice: 'in_workflow',
  metadata: { userId: '', planKey: 'premium_monthly' },
  // current_period_start/end belong on items.data[0] in Stripe API v2026-06-24.dahlia —
  // mapStripeSubscriptionToUpsert reads sub.items.data[0]?.current_period_{start,end}.
  items: {
    data: [{
      price: { id: 'price_test_monthly' },
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    }],
  },
};

describe('Stripe webhook workflows', () => {
  let userId: string;
  let currentEvent: any;
  let retrieveSubscription: jest.Mock;
  let fakeStripe: any;
  let sequence = 0;

  const event = (type: string, object: any, id = `evt_workflow_${++sequence}_${TS}`) => ({
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object },
  });

  const deliver = (stripeEvent: any) => {
    currentEvent = stripeEvent;
    return request(app)
      .post('/api/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'test_signature')
      .send(Buffer.from('{}'));
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    await initDb();
    const user = await registerAndLoginWebUser({
      firstName: 'Webhook',
      lastName: 'Workflow',
      email: EMAIL,
      password: PASSWORD,
    });
    userId = user.userId;
    subscription.metadata.userId = userId;
    await upsertBillingCustomer({
      userId,
      stripeCustomerId: subscription.customer,
      emailSnapshot: EMAIL,
      livemode: false,
    });

    retrieveSubscription = jest.fn().mockImplementation(async () => ({ ...subscription }));
    fakeStripe = {
      subscriptions: { retrieve: retrieveSubscription },
      invoices: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'in_workflow',
          parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
        }),
      },
      charges: {
        retrieve: jest.fn().mockResolvedValue({ id: 'ch_workflow', customer: subscription.customer }),
      },
      webhooks: {
        constructEvent: jest.fn().mockImplementation(() => currentEvent),
      },
    };
    setStripeClientForTesting(fakeStripe);
  });

  afterAll(async () => {
    setStripeClientForTesting(null);
    delete process.env.STRIPE_BILLING_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  it('checkout.session.completed with a trialing subscription → stored as trialing and tier = premium', async () => {
    // Simulate the typical new-user path: checkout creates a trial subscription.
    subscription.status = 'trialing';
    subscription.trial_end = Math.floor(Date.now() / 1000) + 14 * 24 * 3600; // 14 days from now

    await deliver(event('checkout.session.completed', {
      id: 'cs_workflow_trial',
      mode: 'subscription',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);

    const stored = await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID);
    if (!stored) throw new Error(`Expected subscription ${SUBSCRIPTION_ID} in DB after checkout.session.completed (trialing)`);
    expect(stored.status).toBe('trialing');
    expect(stored.trialEnd).toBeTruthy();
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
    expect(await getBillingTrialUsageByEmail(EMAIL.toLowerCase())).toMatchObject({
      emailNormalized: EMAIL.toLowerCase(),
      userId,
      stripeCustomerId: subscription.customer,
      stripeSubscriptionId: SUBSCRIPTION_ID,
    });
  });

  it('customer.subscription.trial_will_end → acknowledged and subscription remains premium', async () => {
    subscription.status = 'trialing';
    subscription.trial_end = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;

    const res = await deliver(event('customer.subscription.trial_will_end', { id: SUBSCRIPTION_ID })).expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.handled).toBeUndefined();
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('trialing');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
    const notifications = await listBillingNotificationsForUser(userId);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'premium_trial_will_end',
          stripeSubscriptionId: SUBSCRIPTION_ID,
          title: 'Premium trial ending soon',
        }),
      ]),
    );
  });

  it('trial converts to active (customer.subscription.updated) → status=active, trialEnd preserved, tier stays premium', async () => {
    // Trial period ended; Stripe transitions the subscription to active and charges the card.
    // The webhook fires a customer.subscription.updated event.
    subscription.status = 'active';
    // trial_end is now in the past — Stripe still sends it in the payload for record-keeping.
    subscription.trial_end = Math.floor(Date.now() / 1000) - 60;

    await deliver(event('customer.subscription.updated', { id: SUBSCRIPTION_ID })).expect(200);

    const stored = await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID);
    if (!stored) throw new Error(`Expected subscription ${SUBSCRIPTION_ID} in DB after trial-to-active update`);
    expect(stored.status).toBe('active');
    // trialEnd must be stored so the UI can show "your trial ended on <date>".
    expect(stored.trialEnd).toBeTruthy();
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');

    // Reset trial_end so subsequent tests start from a clean active state.
    subscription.trial_end = null;
  });

  it('grants Premium from checkout.session.completed', async () => {
    await deliver(event('checkout.session.completed', {
      id: 'cs_workflow',
      mode: 'subscription',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('active');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('checkout.session.completed clears the billing checkout claim so the user can start a new checkout', async () => {
    // Simulate the state right before a checkout completes: a pending claim exists in
    // billing_checkout_claims, created by POST /api/billing/checkout-session.
    const firstClaim = await claimBillingCheckout({
      userId,
      claimToken: `claim_wf_${TS}`,
      planKey: 'premium_monthly',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    if (!firstClaim.claimed) {
      throw new Error(
        `Test setup failed: could not create checkout claim for userId=${userId}. ` +
        `A non-expired claim already exists (checkoutUrl=${firstClaim.checkoutUrl ?? 'null'}). ` +
        `An earlier test may have left a stale claim in the DB.`,
      );
    }

    await deliver(event('checkout.session.completed', {
      id: `cs_workflow_claim_${TS}`,
      mode: 'subscription',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);

    // Verify the claim was deleted: a new claimBillingCheckout call should succeed
    // (INSERT wins because no unexpired row is blocking it).
    // If clearBillingCheckoutClaim was NOT called by the handler, the unexpired row
    // blocks this INSERT and claimed=false — the user would get 409 "checkout already
    // being created" on their next checkout attempt instead of a fresh session URL.
    const afterWebhook = await claimBillingCheckout({
      userId,
      claimToken: `claim_wf_after_${TS}`,
      planKey: 'premium_monthly',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    if (!afterWebhook.claimed) {
      throw new Error(
        `Expected clearBillingCheckoutClaim(userId) to have been called inside ` +
        `handleCheckoutSessionCompleted, but the original checkout claim is still present. ` +
        `The user's next checkout attempt would return 409 instead of a new session URL. ` +
        `Lingering claim checkoutUrl=${afterWebhook.checkoutUrl ?? 'null'}.`,
      );
    }
  });

  it('records scheduled cancellation while retaining Premium', async () => {
    subscription.cancel_at_period_end = true;
    await deliver(event('customer.subscription.updated', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.cancelAtPeriodEnd).toBe(true);
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('customer.subscription.paused downgrades and resumed restores Premium from live Stripe state', async () => {
    subscription.cancel_at_period_end = false;
    subscription.status = 'paused';
    await deliver(event('customer.subscription.paused', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('paused');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('free');

    subscription.status = 'active';
    await deliver(event('customer.subscription.resumed', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('active');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('subscription pending-update events sync the current plan from Stripe', async () => {
    await upsertBillingPlanConfig({
      planKey: 'premium_annual',
      activeStripePriceId: 'price_test_annual',
      unitAmountCents: 3500,
      livemode: false,
      updatedBy: null,
    });
    subscription.status = 'active';
    subscription.items.data[0].price.id = 'price_test_annual';

    await deliver(event('customer.subscription.pending_update_applied', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.planKey).toBe('premium_annual');

    subscription.items.data[0].price.id = 'price_test_monthly';
    await deliver(event('customer.subscription.pending_update_expired', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.planKey).toBe('premium_monthly');
  });

  it('resolves a portal plan switch from the current Price instead of stale metadata', async () => {
    await upsertBillingPlanConfig({
      planKey: 'premium_annual',
      activeStripePriceId: 'price_test_annual',
      unitAmountCents: 3500,
      livemode: false,
      updatedBy: null,
    });
    subscription.items.data[0].price.id = 'price_test_annual';
    subscription.metadata.planKey = 'premium_monthly';
    await deliver(event('customer.subscription.updated', { id: SUBSCRIPTION_ID })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.planKey).toBe('premium_annual');
    subscription.items.data[0].price.id = 'price_test_monthly';
  });

  it('starts the past-due clock once and clears it after payment', async () => {
    subscription.status = 'past_due';
    await deliver(event('invoice.payment_failed', {
      id: 'in_failed',
      parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
    })).expect(200);
    const firstPastDue = (await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince;
    expect(firstPastDue).toBeTruthy();

    await deliver(event('invoice.payment_action_required', {
      id: 'in_action',
      parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince).toBe(firstPastDue);

    subscription.status = 'active';
    await deliver(event('invoice.payment_succeeded', {
      id: 'in_paid',
      parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince).toBeNull();
  });

  it('does not revoke Premium for a partial refund', async () => {
    await deliver(event('charge.refunded', {
      id: 'ch_partial',
      customer: subscription.customer,
      amount: 500,
      amount_refunded: 200,
    })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.accessRevokedAt).toBeNull();
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('restores access when a previously full refund fails', async () => {
    await deliver(event('charge.refunded', {
      id: 'ch_full_then_failed',
      customer: subscription.customer,
      amount: 500,
      amount_refunded: 500,
    })).expect(200);
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('free');

    fakeStripe.charges.retrieve.mockResolvedValueOnce({
      id: 'ch_full_then_failed',
      customer: subscription.customer,
      amount: 500,
      amount_refunded: 0,
    });
    await deliver(event('refund.updated', {
      id: 're_failed',
      charge: 'ch_full_then_failed',
      status: 'failed',
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.accessRevokedAt).toBeNull();
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('revokes for an opened dispute, keeps revocation when lost, and restores when won', async () => {
    await deliver(event('charge.dispute.created', {
      id: 'dp_workflow',
      charge: 'ch_workflow',
      status: 'needs_response',
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.disputeId).toBe('dp_workflow');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('free');

    await deliver(event('charge.dispute.closed', {
      id: 'dp_workflow',
      charge: 'ch_workflow',
      status: 'lost',
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.accessRevokedAt).toBeTruthy();

    await deliver(event('charge.dispute.closed', {
      id: 'dp_workflow',
      charge: 'ch_workflow',
      status: 'won',
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.accessRevokedAt).toBeNull();
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('acknowledges unsupported and duplicate events idempotently', async () => {
    const unsupported = event('customer.created', { id: 'cus_unsupported' });
    const first = await deliver(unsupported).expect(200);
    expect(first.body.handled).toBe(false);
    expect((await getStripeWebhookEvent(unsupported.id))?.processingStatus).toBe('processed');

    const duplicate = await deliver(unsupported).expect(200);
    expect(duplicate.body.duplicate).toBe(true);
  });

  it('marks handler failures and successfully processes the Stripe retry', async () => {
    const retryEvent = event('customer.subscription.updated', { id: SUBSCRIPTION_ID });
    retrieveSubscription.mockRejectedValueOnce(new Error('temporary Stripe failure'));

    const failed = await deliver(retryEvent).expect(500);
    expect(failed.body).toMatchObject({
      error: 'Webhook processing failed.',
      details: 'temporary Stripe failure',
    });
    expect((await getStripeWebhookEvent(retryEvent.id))?.processingStatus).toBe('failed');

    await deliver(retryEvent).expect(200);
    const storedEvent = await getStripeWebhookEvent(retryEvent.id);
    expect(storedEvent?.processingStatus).toBe('processed');
    expect(storedEvent?.attemptCount).toBe(1);
  });

  it('downgrades after the subscription is canceled', async () => {
    subscription.status = 'canceled';
    subscription.ended_at = Math.floor(Date.now() / 1000) as any;
    await deliver(event('customer.subscription.deleted', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('canceled');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('free');
  });
});
