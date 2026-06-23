/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
}));

import {
  createCheckoutSession,
  createPortalSession,
  fetchBillingPlans,
  fetchBillingStatus,
  formatCents,
  isCheckoutAllowedOnPlatform,
  refreshBillingStatus,
} from '../utils/billing';

const backendUrl = 'https://wanderbunnies.test';
const token = 'test-token';

describe('billing client utilities', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('fetches status and plan data with authentication', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ effectiveTier: 'free' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plans: [{ planKey: 'premium_monthly' }] }),
      });

    await expect(fetchBillingStatus(backendUrl, token)).resolves.toMatchObject({ effectiveTier: 'free' });
    await expect(fetchBillingPlans(backendUrl, token)).resolves.toEqual([
      expect.objectContaining({ planKey: 'premium_monthly' }),
    ]);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      `${backendUrl}/api/billing/status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  });

  it('creates web checkout without exposing a client-controlled Price ID', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.test/session' }),
    });

    await createCheckoutSession(backendUrl, token, 'premium_monthly', 'idem-1');
    const request = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({
      planKey: 'premium_monthly',
      idempotencyKey: 'idem-1',
      clientPlatform: 'web',
    });
    expect(request.body).not.toContain('price_');
  });

  it('uses server-controlled portal and refresh endpoints', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://billing.stripe.test/session' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: { effectiveTier: 'premium' } }),
      });

    await expect(createPortalSession(backendUrl, token)).resolves.toEqual({
      url: 'https://billing.stripe.test/session',
    });
    await expect(refreshBillingStatus(backendUrl, token)).resolves.toMatchObject({
      effectiveTier: 'premium',
    });
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({});
  });

  it('fails closed for network and non-success responses', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false });
    await expect(fetchBillingStatus(backendUrl, token)).resolves.toBeNull();
    await expect(fetchBillingPlans(backendUrl, token)).resolves.toEqual([]);
  });

  it('allows checkout on web and formats configured integer cents', () => {
    expect(isCheckoutAllowedOnPlatform()).toBe(true);
    expect(formatCents(3500, 'usd')).toBe('$35');
  });
});
