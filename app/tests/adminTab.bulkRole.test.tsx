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

const userListResponse = {
  users: [
    { id: 'user-1', email: 'one@example.com', firstName: 'One', lastName: 'Tester', role: 'user', tierKey: 'free' },
    { id: 'user-2', email: 'two@example.com', firstName: 'Two', lastName: 'Tester', role: 'user', tierKey: 'free' },
  ],
  total: 2,
};

const createJsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

describe('AdminTab users bulk role change', () => {
  let bulkRoleCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    bulkRoleCalls = [];
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/admin/users?') && !url.includes('/bulk-')) {
        return createJsonResponse(userListResponse);
      }
      if (url.endsWith('/api/admin/tiers')) {
        return createJsonResponse({ tiers: [] });
      }
      if (url.endsWith('/api/admin/users/bulk-role') && init?.method === 'POST') {
        bulkRoleCalls.push({ url, init });
        return createJsonResponse({
          updated: [
            { id: 'user-1', role: 'admin', previousRole: 'user' },
            { id: 'user-2', role: 'admin', previousRole: 'user' },
          ],
          failed: [],
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  test('Apply role button is disabled until a role and a ≥3 char reason are set', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />,
    );

    await findByText('one@example.com');
    fireEvent.press(getByTestId('admin-users-row-select-user-1'));

    // Initial: no role, no reason → disabled
    expect(getByTestId('admin-users-bulk-role-apply').props.accessibilityState?.disabled).toBe(true);

    // Pick Admin role, no reason yet
    fireEvent.press(getByTestId('admin-users-bulk-role-admin'));
    expect(getByTestId('admin-users-bulk-role-apply').props.accessibilityState?.disabled).toBe(true);

    // Valid reason
    fireEvent.changeText(getByTestId('admin-users-bulk-reason'), 'Valid reason.');
    expect(getByTestId('admin-users-bulk-role-apply').props.accessibilityState?.disabled).toBe(false);
  });

  test('Apply role button posts to /api/admin/users/bulk-role with the chosen role and ids', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />,
    );

    await findByText('one@example.com');
    fireEvent.press(getByTestId('admin-users-row-select-user-1'));
    fireEvent.press(getByTestId('admin-users-row-select-user-2'));

    fireEvent.press(getByTestId('admin-users-bulk-role-admin'));
    fireEvent.changeText(getByTestId('admin-users-bulk-reason'), 'Batch promotion for on-call team.');
    fireEvent.press(getByTestId('admin-users-bulk-role-apply'));

    await waitFor(() => expect(bulkRoleCalls).toHaveLength(1));
    const body = JSON.parse(String(bulkRoleCalls[0].init?.body ?? '{}'));
    expect(body.role).toBe('admin');
    expect(body.reason).toBe('Batch promotion for on-call team.');
    expect(new Set(body.ids)).toEqual(new Set(['user-1', 'user-2']));
  });

  test('the role selector is a toggle — pressing the active role a second time clears it', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="users" />,
    );

    await findByText('one@example.com');
    fireEvent.press(getByTestId('admin-users-row-select-user-1'));

    fireEvent.press(getByTestId('admin-users-bulk-role-admin'));
    expect(getByTestId('admin-users-bulk-role-admin').props.accessibilityState?.selected).toBe(true);

    fireEvent.press(getByTestId('admin-users-bulk-role-admin'));
    expect(getByTestId('admin-users-bulk-role-admin').props.accessibilityState?.selected).toBe(false);
  });
});
