/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AdminTab from '../tabs/AdminTab';

jest.mock('react-native', () => {
  return {
    Platform: { OS: 'ios' },
    ScrollView: 'ScrollView',
    Text: 'Text',
    TextInput: 'TextInput',
    TouchableOpacity: 'TouchableOpacity',
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    TouchableHighlight: 'TouchableHighlight',
    Pressable: 'Pressable',
    View: 'View',
    Image: 'Image',
    ImageBackground: 'ImageBackground',
    FlatList: 'FlatList',
    SectionList: 'SectionList',
    Switch: 'Switch',
    Modal: 'Modal',
    SafeAreaView: 'SafeAreaView',
    ActivityIndicator: 'ActivityIndicator',
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
    useWindowDimensions: () => ({ width: 800, height: 600 }),
    useColorScheme: () => 'light',
  };
});

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };

const createJsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);

const baseTiers = [
  {
    id: 'tier-free',
    key: 'free',
    displayName: 'Free',
    rank: 1,
    limits: [
      { limitKey: 'max_active_trips', limitValue: 3 },
      { limitKey: 'ai_itinerary_generations_per_month', limitValue: 5 },
    ],
    entitlements: [
      { featureId: 'f0', featureKey: 'csv_export', isAllowed: true },
      { featureId: 'f1', featureKey: 'trip_sharing', isAllowed: true },
      { featureId: 'f2', featureKey: 'cost_tracking', isAllowed: false },
    ],
  },
  {
    id: 'tier-premium',
    key: 'premium',
    displayName: 'Premium',
    rank: 2,
    limits: [
      { limitKey: 'max_active_trips', limitValue: 250 },
      { limitKey: 'ai_itinerary_generations_per_month', limitValue: -1 },
    ],
    entitlements: [
      { featureId: 'f2', featureKey: 'cost_tracking', isAllowed: true },
    ],
  },
  {
    id: 'tier-pro',
    key: 'pro',
    displayName: 'Pro',
    rank: 3,
    limits: [
      { limitKey: 'max_active_trips', limitValue: 250 },
      { limitKey: 'ai_itinerary_generations_per_month', limitValue: -1 },
    ],
    entitlements: [
      { featureId: 'f2', featureKey: 'cost_tracking', isAllowed: true },
    ],
  },
];

describe('AdminTab tier table', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  test('renders the tier matrix and saves a numeric limit update through the dialog', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => createJsonResponse({ tiers: baseTiers }))
      .mockImplementationOnce(() => createJsonResponse({ ok: true }))
      .mockImplementationOnce(() =>
        createJsonResponse({
          tiers: baseTiers.map((tier) =>
            tier.key === 'free'
              ? {
                  ...tier,
                  limits: tier.limits.map((limit) =>
                    limit.limitKey === 'max_active_trips' ? { ...limit, limitValue: 4 } : limit
                  ),
                }
              : tier
          ),
        })
      );

    const { findByText, getByTestId, getByText } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="tiers" />
    );

    expect(await findByText('Name')).toBeTruthy();
    expect(await findByText('Free')).toBeTruthy();
    expect(await findByText('Premium')).toBeTruthy();
    expect(await findByText('Pro')).toBeTruthy();
    expect(await findByText('max_active_trips')).toBeTruthy();
    expect(await findByText('cost_tracking')).toBeTruthy();

    fireEvent.press(getByTestId('tier-limit-cell-max_active_trips-free'));

    expect(getByText('Update limit')).toBeTruthy();
    fireEvent.changeText(getByTestId('tier-limit-value-input'), '4');
    fireEvent.changeText(getByTestId('tier-limit-reason-input'), 'Adjusting the free tier trip cap.');
    fireEvent.press(getByTestId('tier-limit-save-button'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${backendUrl}/api/admin/tiers/free/limits/max_active_trips`,
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            limitValue: 4,
            reason: 'Adjusting the free tier trip cap.',
          }),
        })
      );
    });

    expect(await findByText('Limit updated.')).toBeTruthy();
  });

  test('opens the feature dialog and saves a toggle change with a reason', async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => createJsonResponse({ tiers: baseTiers }))
      .mockImplementationOnce(() => createJsonResponse({ ok: true }))
      .mockImplementationOnce(() =>
        createJsonResponse({
          tiers: baseTiers.map((tier) =>
            tier.key === 'free'
              ? {
                  ...tier,
                  entitlements: tier.entitlements.map((entitlement) =>
                    entitlement.featureKey === 'cost_tracking'
                      ? { ...entitlement, isAllowed: true }
                      : entitlement
                  ),
                }
              : tier
          ),
        })
      );

    const { findByText, getByTestId, getByText, queryByText } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="tiers" />
    );

    expect(await findByText('cost_tracking')).toBeTruthy();
    fireEvent.press(getByTestId('tier-feature-cell-cost_tracking-free'));

    expect(getByText('Change feature access')).toBeTruthy();
    fireEvent.changeText(getByTestId('tier-feature-reason-input'), 'Enabling this for validation.');
    fireEvent.press(getByTestId('tier-feature-save-button'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${backendUrl}/api/admin/tiers/free/features/cost_tracking`,
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            isAllowed: true,
            reason: 'Enabling this for validation.',
          }),
        })
      );
    });

    expect(await findByText('Entitlement updated.')).toBeTruthy();

    fireEvent.press(getByTestId('tier-feature-cell-cost_tracking-free'));
    expect(getByText('Change feature access')).toBeTruthy();
    fireEvent.press(getByTestId('tier-feature-cancel-button'));
    await waitFor(() => expect(queryByText('Change feature access')).toBeNull());
  });

  test('shows inherited feature access for higher tiers and keeps inherited toggles locked', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => createJsonResponse({ tiers: baseTiers }));

    const { findByText, findAllByText, getByTestId, queryByText } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="tiers" />
    );

    expect(await findByText('csv_export')).toBeTruthy();
    expect((await findAllByText('Inherited')).length).toBeGreaterThanOrEqual(2);
    expect((await findAllByText('From Free')).length).toBeGreaterThanOrEqual(2);

    fireEvent.press(getByTestId('tier-feature-cell-csv_export-premium'));
    expect(queryByText('Change feature access')).toBeNull();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
