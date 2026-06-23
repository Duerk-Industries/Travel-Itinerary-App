/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PremiumSubscriptionPanel } from '../components/PremiumSubscriptionPanel';
import {
  createCheckoutSession,
  createPortalSession,
  isCheckoutAllowedOnPlatform,
  openBillingUrl,
} from '../utils/billing';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  TouchableHighlight: 'TouchableHighlight',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  ImageBackground: 'ImageBackground',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  Switch: 'Switch',
  Modal: 'Modal',
  SafeAreaView: 'SafeAreaView',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => styles,
    flatten: (style: unknown) => style,
  },
}));

jest.mock('../utils/billing', () => ({
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  openBillingUrl: jest.fn(),
  isCheckoutAllowedOnPlatform: jest.fn(),
  formatCents: (cents: number) => `$${cents / 100}`,
}));

const baseStatus = {
  effectiveTier: 'free',
  isBillingManaged: false,
  plan: null,
  subscriptionStatus: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  inGracePeriod: false,
  accessRevoked: false,
  checkoutAvailable: true,
  portalAvailable: false,
} as const;

const plans = [
  { planKey: 'premium_monthly' as const, amountCents: 500, currency: 'usd', interval: 'month' as const, trialDays: 14 },
  { planKey: 'premium_annual' as const, amountCents: 3500, currency: 'usd', interval: 'year' as const, trialDays: 14 },
];

describe('PremiumSubscriptionPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isCheckoutAllowedOnPlatform as jest.Mock).mockReturnValue(true);
    (openBillingUrl as jest.Mock).mockResolvedValue(true);
  });

  it('starts the selected annual web checkout and opens Stripe', async () => {
    (createCheckoutSession as jest.Mock).mockResolvedValue({
      url: 'https://checkout.stripe.test/session',
    });
    const onRefresh = jest.fn();
    const { getByText, getByLabelText } = render(
      <PremiumSubscriptionPanel
        backendUrl="https://wanderbunnies.test"
        token="token"
        billingStatus={baseStatus}
        plans={plans}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.press(getByText('Annual'));
    fireEvent.press(getByLabelText('Upgrade to Premium'));

    await waitFor(() => {
      expect(createCheckoutSession).toHaveBeenCalledWith(
        'https://wanderbunnies.test',
        'token',
        'premium_annual',
        expect.stringMatching(/^ck_/),
      );
      expect(openBillingUrl).toHaveBeenCalledWith('https://checkout.stripe.test/session');
    });
  });

  it('hides external checkout on native and shows web-upgrade guidance', () => {
    (isCheckoutAllowedOnPlatform as jest.Mock).mockReturnValue(false);
    const { getByText, queryByLabelText } = render(
      <PremiumSubscriptionPanel
        backendUrl="https://wanderbunnies.test"
        token="token"
        billingStatus={baseStatus}
        plans={plans}
        onRefresh={jest.fn()}
      />,
    );
    expect(queryByLabelText('Upgrade to Premium')).toBeNull();
    expect(getByText('Visit wanderbunnies.com on a web browser to upgrade to Premium.')).toBeTruthy();
  });

  it('shows grace-period and cancellation state for Premium users', () => {
    const { getByText } = render(
      <PremiumSubscriptionPanel
        backendUrl="https://wanderbunnies.test"
        token="token"
        billingStatus={{
          ...baseStatus,
          effectiveTier: 'premium',
          isBillingManaged: true,
          plan: 'annual',
          subscriptionStatus: 'past_due',
          currentPeriodEnd: '2026-08-01T00:00:00.000Z',
          cancelAtPeriodEnd: true,
          inGracePeriod: true,
          portalAvailable: true,
        }}
        plans={plans}
        onRefresh={jest.fn()}
      />,
    );
    expect(getByText('Annual')).toBeTruthy();
    expect(getByText('Payment issue — grace period active')).toBeTruthy();
    expect(getByText(/Cancels/)).toBeTruthy();
  });

  it('opens the Customer Portal for the authenticated subscription', async () => {
    (createPortalSession as jest.Mock).mockResolvedValue({
      url: 'https://billing.stripe.test/session',
    });
    const { getByLabelText } = render(
      <PremiumSubscriptionPanel
        backendUrl="https://wanderbunnies.test"
        token="token"
        billingStatus={{ ...baseStatus, effectiveTier: 'premium', portalAvailable: true }}
        plans={plans}
        onRefresh={jest.fn()}
      />,
    );

    fireEvent.press(getByLabelText('Manage subscription'));
    await waitFor(() => {
      expect(createPortalSession).toHaveBeenCalledWith('https://wanderbunnies.test', 'token');
      expect(openBillingUrl).toHaveBeenCalledWith('https://billing.stripe.test/session');
    });
  });
});
