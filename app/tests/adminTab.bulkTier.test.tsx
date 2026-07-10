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
      hairlineWidth: 1,
    },
    useWindowDimensions: () => ({ width: 800, height: 600 }),
    useColorScheme: () => 'light',
  };
});

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };

const tiers = [
  { id: 'tier-free', key: 'free', displayName: 'Free', rank: 1, limits: [], entitlements: [] },
  { id: 'tier-premium', key: 'premium', displayName: 'Premium', rank: 2, limits: [], entitlements: [] },
  { id: 'tier-pro', key: 'pro', displayName: 'Pro', rank: 3, limits: [], entitlements: [] },
];

const userListResponse = {
  users: [
    { id: 'user-1', email: 'one@example.com', firstName: 'One', lastName: 'Tester', role: 'user', tierKey: 'free' },
    { id: 'user-2', email: 'two@example.com', firstName: 'Two', lastName: 'Tester', role: 'user', tierKey: 'free' },
    { id: 'user-3', email: 'three@example.com', firstName: 'Three', lastName: 'Tester', role: 'user', tierKey: 'free' },
  ],
  total: 3,
};

const createJsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response);

describe('AdminTab users bulk tier change', () => {
  let bulkTierCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    bulkTierCalls = [];
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/admin/users?') && !url.includes('/bulk-tier')) {
        return createJsonResponse(userListResponse);
      }
      if (url.endsWith('/api/admin/tiers')) {
        return createJsonResponse({ tiers });
      }
      if (url.endsWith('/api/admin/users/bulk-tier') && init?.method === 'POST') {
        bulkTierCalls.push({ url, init });
        return createJsonResponse({
          updated: [
            { id: 'user-1', tierKey: 'premium', lockedToPro: false },
            { id: 'user-2', tierKey: 'premium', lockedToPro: false },
          ],
          failed: [],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  test('bulk action bar is hidden until a user is selected, then posts bulk-tier with the selection', async () => {
    const { findByText, getByTestId, queryByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />
    );

    await findByText('one@example.com');
    expect(queryByTestId('admin-users-bulk-action-bar')).toBeNull();

    fireEvent.press(getByTestId('admin-users-row-select-user-1'));
    fireEvent.press(getByTestId('admin-users-row-select-user-2'));
    expect(getByTestId('admin-users-bulk-action-bar')).toBeTruthy();

    fireEvent.press(getByTestId('admin-users-bulk-tier-dropdown-toggle'));
    fireEvent.press(getByTestId('admin-users-bulk-tier-option-premium'));
    fireEvent.changeText(getByTestId('admin-users-bulk-reason'), 'Upgrade batch for support review.');
    fireEvent.press(getByTestId('admin-users-bulk-apply'));

    await waitFor(() => {
      expect(bulkTierCalls).toHaveLength(1);
    });
    const body = JSON.parse(String(bulkTierCalls[0].init?.body ?? '{}'));
    expect(body.tierKey).toBe('premium');
    expect(body.reason).toBe('Upgrade batch for support review.');
    expect(new Set(body.ids)).toEqual(new Set(['user-1', 'user-2']));
  });

  test('apply button is disabled until both a tier and a >=3 char reason are set', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />
    );

    await findByText('one@example.com');
    fireEvent.press(getByTestId('admin-users-row-select-user-1'));

    // No tier, no reason → disabled.
    expect(getByTestId('admin-users-bulk-apply').props.accessibilityState?.disabled).toBe(true);

    // Select tier only.
    fireEvent.press(getByTestId('admin-users-bulk-tier-dropdown-toggle'));
    fireEvent.press(getByTestId('admin-users-bulk-tier-option-premium'));
    expect(getByTestId('admin-users-bulk-apply').props.accessibilityState?.disabled).toBe(true);

    // Too-short reason.
    fireEvent.changeText(getByTestId('admin-users-bulk-reason'), 'hi');
    expect(getByTestId('admin-users-bulk-apply').props.accessibilityState?.disabled).toBe(true);

    // Valid reason.
    fireEvent.changeText(getByTestId('admin-users-bulk-reason'), 'Valid reason.');
    expect(getByTestId('admin-users-bulk-apply').props.accessibilityState?.disabled).toBe(false);
  });

  test('Clear button empties selection and hides the bulk bar', async () => {
    const { findByText, getByTestId, queryByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />
    );

    await findByText('one@example.com');
    fireEvent.press(getByTestId('admin-users-row-select-user-1'));
    expect(getByTestId('admin-users-bulk-action-bar')).toBeTruthy();

    fireEvent.press(getByTestId('admin-users-bulk-clear'));
    expect(queryByTestId('admin-users-bulk-action-bar')).toBeNull();
  });
});
