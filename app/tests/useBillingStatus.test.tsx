/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useBillingStatus } from '../hooks/useBillingStatus';
import { fetchBillingStatus, refreshBillingStatus } from '../utils/billing';

jest.mock('../utils/billing', () => ({
  fetchBillingStatus: jest.fn(),
  refreshBillingStatus: jest.fn(),
}));

const status = {
  effectiveTier: 'premium',
  isBillingManaged: true,
  plan: 'monthly',
  subscriptionStatus: 'active',
  currentPeriodEnd: null,
  trialEnd: null,
  trialEligible: false,
  trialEndingSoon: false,
  cancelAtPeriodEnd: false,
  inGracePeriod: false,
  accessRevoked: false,
  checkoutAvailable: false,
  portalAvailable: true,
};

describe('useBillingStatus Checkout return', () => {
  // The Stripe Checkout return flow reads window.location, which only exists as a real
  // browser location on web (see useBillingStatus.ts) — force the platform explicitly rather
  // than relying on the react-native mock's default.
  const originalOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'web';
    (fetchBillingStatus as jest.Mock).mockResolvedValue(status);
    (refreshBillingStatus as jest.Mock).mockResolvedValue(status);
    window.history.replaceState({}, '', '/?billing=success');
  });
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('does not read window.location on native, even if a stray billing=success param exists in a WebView URL', async () => {
    Platform.OS = 'ios';
    const { result } = renderHook(() =>
      useBillingStatus({
        backendUrl: 'https://api.example.test',
        token: 'token',
      }),
    );
    await waitFor(() => {
      expect(fetchBillingStatus).toHaveBeenCalled();
    });
    expect(refreshBillingStatus).not.toHaveBeenCalled();
    expect(result.current.checkoutSuccessMessage).toBeNull();
  });

  it('synchronizes Stripe state and removes the success marker', async () => {
    const { result } = renderHook(() =>
      useBillingStatus({
        backendUrl: 'https://api.example.test',
        token: 'token',
      }),
    );

    await waitFor(() => {
      expect(refreshBillingStatus).toHaveBeenCalledWith('https://api.example.test', 'token');
      expect(result.current.billingStatus?.effectiveTier).toBe('premium');
      expect(result.current.checkoutSuccessMessage).toBe('Premium subscription is active.');
      expect(window.location.search).toBe('');
    });
  });

  it('uses trial-specific confirmation copy after Checkout starts a trial', async () => {
    (refreshBillingStatus as jest.Mock).mockResolvedValue({
      ...status,
      subscriptionStatus: 'trialing',
    });

    const { result } = renderHook(() =>
      useBillingStatus({
        backendUrl: 'https://api.example.test',
        token: 'token',
      }),
    );

    await waitFor(() => {
      expect(result.current.checkoutSuccessMessage).toBe('Premium trial is active.');
    });

    result.current.clearCheckoutSuccessMessage();

    await waitFor(() => {
      expect(result.current.checkoutSuccessMessage).toBeNull();
    });
  });
});
