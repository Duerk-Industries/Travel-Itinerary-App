/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PremiumPlanComparisonDialog from '../components/PremiumPlanComparisonDialog';
import {
  createCheckoutSession,
  fetchBillingPlans,
  openBillingUrl,
} from '../utils/billing';

jest.mock('../utils/billing', () => ({
  fetchBillingPlans: jest.fn(),
  createCheckoutSession: jest.fn(),
  openBillingUrl: jest.fn(),
  isCheckoutAllowedOnPlatform: jest.fn(() => true),
  formatCents: jest.fn((cents: number) => `$${cents / 100}`),
}));

const styles = {
  modalOverlay: {},
  confirmModal: {},
  sectionTitle: {},
  helperText: {},
  errorText: {},
  button: {},
  secondaryButton: {},
  secondaryButtonText: {},
  buttonDisabled: {},
  planComparisonModal: {},
  planComparisonGrid: {},
  planComparisonTier: {},
  planComparisonTierPremium: {},
  planComparisonTierTitle: {},
  planComparisonFeatureList: {},
  planComparisonFeature: {},
  planComparisonOptions: {},
  planComparisonOption: {},
  planComparisonOptionTitle: {},
  planComparisonOptionPrice: {},
  planComparisonOptionTrial: {},
  planComparisonMaybeLater: {},
};

const plans = [
  { planKey: 'premium_monthly' as const, amountCents: 500, currency: 'usd', interval: 'month' as const, trialDays: 14 },
  { planKey: 'premium_annual' as const, amountCents: 3500, currency: 'usd', interval: 'year' as const, trialDays: 14 },
];

describe('PremiumPlanComparisonDialog', () => {
  beforeEach(() => {
    jest.mocked(fetchBillingPlans).mockResolvedValue(plans);
    jest.mocked(createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/c/test' });
    jest.mocked(openBillingUrl).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows Basic and Premium quotas, live prices, and annual discount', async () => {
    const { findByText, getByText, getAllByText } = render(
      <PremiumPlanComparisonDialog
        visible
        backendUrl="https://api.example.test"
        token="token-1"
        styles={styles}
        onMaybeLater={jest.fn()}
      />,
    );

    expect(await findByText('Compare plans')).toBeTruthy();
    expect(getByText('Basic')).toBeTruthy();
    expect(getByText('- 3 active trips')).toBeTruthy();
    expect(getByText('- 6 travelers per trip')).toBeTruthy();
    expect(getByText('- 5 AI itineraries per month')).toBeTruthy();
    expect(getByText('Premium')).toBeTruthy();
    expect(getByText('- 250 active trips')).toBeTruthy();
    expect(getByText('- 200 travelers per trip')).toBeTruthy();
    expect(getByText('- Unlimited AI itineraries')).toBeTruthy();
    expect(getByText('$5/mo')).toBeTruthy();
    expect(getByText('$35/yr (42% off monthly)')).toBeTruthy();
    expect(getAllByText('14-day free trial')).toHaveLength(2);
  });

  it('starts Stripe Checkout for the selected annual plan', async () => {
    const { findByText, getByTestId } = render(
      <PremiumPlanComparisonDialog
        visible
        backendUrl="https://api.example.test"
        token="token-1"
        styles={styles}
        onMaybeLater={jest.fn()}
      />,
    );

    await findByText('$35/yr (42% off monthly)');
    fireEvent.press(getByTestId('premium-plan-option-premium_annual'));

    await waitFor(() => {
      expect(createCheckoutSession).toHaveBeenCalledWith(
        'https://api.example.test',
        'token-1',
        'premium_annual',
        expect.stringMatching(/^welcome_premium_annual_/),
      );
      expect(openBillingUrl).toHaveBeenCalledWith('https://checkout.stripe.com/c/test');
    });
  });

  it('lets a new user continue to Account without checkout', async () => {
    const onMaybeLater = jest.fn();
    const { findByText, getByTestId } = render(
      <PremiumPlanComparisonDialog
        visible
        backendUrl="https://api.example.test"
        token="token-1"
        styles={styles}
        onMaybeLater={onMaybeLater}
      />,
    );

    await findByText('$5/mo');
    fireEvent.press(getByTestId('premium-plan-maybe-later'));

    expect(onMaybeLater).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});
