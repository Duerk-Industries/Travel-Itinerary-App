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
    {
      id: 'user-1',
      email: 'test.user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'user',
      tierKey: 'free',
    },
  ],
  total: 1,
};

const createJsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);

describe('AdminTab user detail tier controls', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/admin/users?page=1&limit=20')) {
        return createJsonResponse(userListResponse);
      }
      if (url.endsWith('/api/admin/users/user-1')) {
        return createJsonResponse({
          id: 'user-1',
          email: 'test.user@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'user',
          tierKey: 'free',
          usage: [],
        });
      }
      if (url.endsWith('/api/admin/users/admin-1')) {
        return createJsonResponse({
          id: 'admin-1',
          email: 'admin.user@example.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
          tierKey: 'free',
          usage: [],
        });
      }
      if (url.endsWith('/api/admin/tiers')) {
        return createJsonResponse({ tiers });
      }
      if (url.endsWith('/api/admin/users/user-1/tier') && init?.method === 'PATCH') {
        return createJsonResponse({ userId: 'user-1', tierKey: 'premium', lockedToPro: false });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  test('loads tier options on the user detail page and saves the selected tier', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />
    );

    const userRow = await findByText('test.user@example.com');
    fireEvent.press(userRow);

    expect(await findByText('Current Tier: free')).toBeTruthy();

    fireEvent.press(getByTestId('user-tier-dropdown-button'));
    expect(await findByText('Premium')).toBeTruthy();

    fireEvent.press(getByTestId('user-tier-option-premium'));
    fireEvent.changeText(getByTestId('user-tier-reason-input'), 'Upgrade for support review.');
    fireEvent.press(getByTestId('user-tier-save-button'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${backendUrl}/api/admin/users/user-1/tier`,
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            tierKey: 'premium',
            reason: 'Upgrade for support review.',
          }),
        })
      );
    });
  });

  test('shows admin users as locked to Pro tier', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin/users?page=1&limit=20')) {
        return createJsonResponse({
          users: [
            {
              id: 'admin-1',
              email: 'admin.user@example.com',
              firstName: 'Admin',
              lastName: 'User',
              role: 'admin',
              tierKey: 'pro',
            },
          ],
          total: 1,
        });
      }
      if (url.endsWith('/api/admin/users/admin-1')) {
        return createJsonResponse({
          id: 'admin-1',
          email: 'admin.user@example.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
          tierKey: 'free',
          usage: [],
        });
      }
      if (url.endsWith('/api/admin/tiers')) {
        return createJsonResponse({ tiers });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const { findByText, queryByTestId, queryByText } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />
    );

    fireEvent.press(await findByText('admin.user@example.com'));
    expect(await findByText('Current Tier: pro')).toBeTruthy();
    expect(await findByText('Admin users are automatically assigned the Pro tier.')).toBeTruthy();
    expect(queryByTestId('user-tier-dropdown-button')).toBeNull();
    await waitFor(() => expect(queryByText('Premium')).toBeNull());
  });
});
