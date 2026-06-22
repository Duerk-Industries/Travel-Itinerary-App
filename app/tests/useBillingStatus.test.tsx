/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react-native';
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
  cancelAtPeriodEnd: false,
  inGracePeriod: false,
  accessRevoked: false,
  checkoutAvailable: false,
  portalAvailable: true,
};

describe('useBillingStatus Checkout return', () => {
  beforeEach(() => {
    (fetchBillingStatus as jest.Mock).mockResolvedValue(status);
    (refreshBillingStatus as jest.Mock).mockResolvedValue(status);
    window.history.replaceState({}, '', '/?billing=success');
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
      expect(window.location.search).toBe('');
    });
  });
});
