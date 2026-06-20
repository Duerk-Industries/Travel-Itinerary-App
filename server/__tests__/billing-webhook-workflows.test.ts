import request from 'supertest';
import { app } from '../src/app';
import {
  closePool,
  getBillingSubscriptionByStripeId,
  getCurrentUserTier,
  getStripeWebhookEvent,
  initDb,
  upsertBillingCustomer,
} from '../src/db';
import { setStripeClientForTesting } from '../src/billing/stripeClient';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const EMAIL = `billing-webhooks+${TS}@example.com`;
const PASSWORD = 'BillingWebhook1!';
const SUBSCRIPTION_ID = `sub_workflow_${TS}`;

const subscription = {
  id: SUBSCRIPTION_ID,
  status: 'active',
  livemode: false,
  customer: `cus_workflow_${TS}`,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_start: Math.floor(Date.now() / 1000),
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  trial_end: null,
  ended_at: null,
  latest_invoice: 'in_workflow',
  metadata: { userId: '', planKey: 'premium_monthly' },
  items: { data: [{ price: { id: 'price_test_monthly' } }] },
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
        retrieve: jest.fn().mockResolvedValue({ id: 'in_workflow', subscription: SUBSCRIPTION_ID }),
      },
      charges: {
        retrieve: jest.fn().mockResolvedValue({ id: 'ch_workflow', invoice: 'in_workflow' }),
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

  it('grants Premium from checkout.session.completed', async () => {
    await deliver(event('checkout.session.completed', {
      id: 'cs_workflow',
      mode: 'subscription',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.status).toBe('active');
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('records scheduled cancellation while retaining Premium', async () => {
    subscription.cancel_at_period_end = true;
    await deliver(event('customer.subscription.updated', { id: SUBSCRIPTION_ID })).expect(200);

    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.cancelAtPeriodEnd).toBe(true);
    expect((await getCurrentUserTier(userId))?.tierKey).toBe('premium');
  });

  it('starts the past-due clock once and clears it after payment', async () => {
    subscription.status = 'past_due';
    await deliver(event('invoice.payment_failed', {
      id: 'in_failed',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);
    const firstPastDue = (await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince;
    expect(firstPastDue).toBeTruthy();

    await deliver(event('invoice.payment_action_required', {
      id: 'in_action',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince).toBe(firstPastDue);

    subscription.status = 'active';
    await deliver(event('invoice.paid', {
      id: 'in_paid',
      subscription: SUBSCRIPTION_ID,
    })).expect(200);
    expect((await getBillingSubscriptionByStripeId(SUBSCRIPTION_ID))?.pastDueSince).toBeNull();
  });

  it('does not revoke Premium for a partial refund', async () => {
    await deliver(event('charge.refunded', {
      id: 'ch_partial',
      invoice: 'in_workflow',
      amount: 500,
      amount_refunded: 200,
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

    await deliver(retryEvent).expect(500);
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
