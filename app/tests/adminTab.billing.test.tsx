/**
 * @jest-environment node
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AdminTab from '../tabs/AdminTab';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
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
    hairlineWidth: 1,
  },
  useWindowDimensions: () => ({ width: 800, height: 600 }),
  useColorScheme: () => 'light',
}));

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const plan = {
  planKey: 'premium_monthly',
  activeStripePriceId: 'price_test_monthly',
  unitAmountCents: 500,
  currency: 'usd',
  interval: 'month',
  trialDays: 14,
  pastDueGraceDays: 30,
  automaticTaxEnabled: true,
  promotionCodesEnabled: true,
  isCheckoutEnabled: true,
  livemode: false,
};

describe('AdminTab billing section', () => {
  test('loads and saves configurable subscription settings', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/admin/billing/config') && !init?.method) {
        return { ok: true, json: async () => ({ billingEnabled: true, plans: [plan] }) } as Response;
      }
      if (url.endsWith('/api/admin/billing/config/premium_monthly') && init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ ...plan, trialDays: 21 }) } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    (global as any).fetch = fetchMock;

    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="billing" />
    );

    await findByText('Stripe billing is enabled on this server.');
    fireEvent.changeText(getByTestId('admin-billing-premium_monthly-trialDays'), '21');
    fireEvent.press(getByTestId('admin-billing-save-premium_monthly'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${backendUrl}/api/admin/billing/config/premium_monthly`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"trialDays":21'),
        }),
      );
    });
  });

  test('publishes the initial Stripe Price even when the seeded amount is unchanged', async () => {
    const unpublishedPlan = { ...plan, activeStripePriceId: null };
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/admin/billing/config') && !init?.method) {
        return { ok: true, json: async () => ({ billingEnabled: true, plans: [unpublishedPlan] }) } as Response;
      }
      if (url.endsWith('/api/admin/billing/config/premium_monthly') && init?.method === 'PATCH') {
        return { ok: true, json: async () => unpublishedPlan } as Response;
      }
      if (url.endsWith('/api/admin/billing/plans/premium_monthly/price') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ stripePriceId: 'price_initial' }) } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    (global as any).fetch = fetchMock;

    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="billing" />
    );
    await findByText('Active Price: Not published (test)');
    fireEvent.press(getByTestId('admin-billing-save-premium_monthly'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${backendUrl}/api/admin/billing/plans/premium_monthly/price`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ unitAmountCents: 500, currency: 'usd' }),
        }),
      );
    });
  });
});
