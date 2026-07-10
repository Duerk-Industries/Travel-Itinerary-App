/// <reference types="jest" />
/// <reference types="node" />
import { STRIPE_API_VERSION, assertStripeBillingConfig, isStripeLiveMode } from '../src/config/stripeBilling';

describe('Stripe billing startup configuration', () => {
  const keys = [
    'STRIPE_BILLING_ENABLED',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PREMIUM_PRODUCT_ID',
    'STRIPE_CHECKOUT_SUCCESS_URL',
    'STRIPE_CHECKOUT_CANCEL_URL',
    'STRIPE_PORTAL_RETURN_URL',
    'STRIPE_REQUIRE_TAX_CONFIGURATION',
    'STRIPE_TAX_CONFIGURED',
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('fails fast when billing is enabled without required settings', () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    for (const key of keys.slice(1)) delete process.env[key];
    expect(() => assertStripeBillingConfig()).toThrow(
      /STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PREMIUM_PRODUCT_ID, STRIPE_CHECKOUT_SUCCESS_URL, STRIPE_CHECKOUT_CANCEL_URL, STRIPE_PORTAL_RETURN_URL/,
    );
  });

  it('does not require Stripe settings when billing is disabled', () => {
    process.env.STRIPE_BILLING_ENABLED = 'false';
    for (const key of keys.slice(1)) delete process.env[key];
    expect(() => assertStripeBillingConfig()).not.toThrow();
  });

  it('accepts a complete test-mode configuration', () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
    process.env.STRIPE_PREMIUM_PRODUCT_ID = 'prod_example';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://example.com/?billing=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://example.com/?billing=cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'https://example.com/';
    expect(() => assertStripeBillingConfig()).not.toThrow();
  });

  it('accepts restricted Stripe API keys and classifies their mode correctly', () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'rk_test_example';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
    process.env.STRIPE_PREMIUM_PRODUCT_ID = 'prod_example';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://example.com/?billing=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://example.com/?billing=cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'https://example.com/';

    expect(() => assertStripeBillingConfig()).not.toThrow();
    expect(isStripeLiveMode()).toBe(false);

    process.env.STRIPE_SECRET_KEY = 'rk_live_example';
    expect(isStripeLiveMode()).toBe(true);
  });

  it('defaults to the current Stripe dahlia API version', () => {
    expect(STRIPE_API_VERSION).toBe('2026-06-24.dahlia');
  });

  it('fails fast when Stripe Tax confirmation is required but absent', () => {
    process.env.STRIPE_BILLING_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_example';
    process.env.STRIPE_PREMIUM_PRODUCT_ID = 'prod_example';
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://example.com/?billing=success';
    process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://example.com/?billing=cancel';
    process.env.STRIPE_PORTAL_RETURN_URL = 'https://example.com/';
    process.env.STRIPE_REQUIRE_TAX_CONFIGURATION = 'true';
    delete process.env.STRIPE_TAX_CONFIGURED;

    expect(() => assertStripeBillingConfig()).toThrow(/Stripe Tax is required/);
  });
});
