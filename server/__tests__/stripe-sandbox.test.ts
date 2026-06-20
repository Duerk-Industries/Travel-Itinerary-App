import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../src/config/stripeBilling';

const enabled = process.env.STRIPE_SANDBOX_TESTS === '1';
const describeSandbox = enabled ? describe : describe.skip;

describeSandbox('Stripe sandbox integration', () => {
  jest.setTimeout(30_000);

  it('creates and expires a test-mode subscription Checkout session', async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
    if (!secretKey?.startsWith('sk_test_')) {
      throw new Error('STRIPE_SANDBOX_TESTS requires a Stripe sk_test_ secret');
    }
    if (!priceId) {
      throw new Error('STRIPE_PREMIUM_MONTHLY_PRICE_ID is required');
    }

    const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
    const price = await stripe.prices.retrieve(priceId);
    expect(price.livemode).toBe(false);
    expect(price.active).toBe(true);
    expect(price.recurring?.interval).toBe('month');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { testRun: 'stripe-sandbox-jest' },
      },
      success_url: 'https://example.com/billing/success',
      cancel_url: 'https://example.com/billing/cancel',
      metadata: { testRun: 'stripe-sandbox-jest' },
    });

    expect(session.livemode).toBe(false);
    expect(session.status).toBe('open');
    await stripe.checkout.sessions.expire(session.id);
  });
});
