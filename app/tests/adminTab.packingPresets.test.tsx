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

const createJsonResponse = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

describe('AdminTab packing preset catalog section', () => {
  let putBody: any = null;

  beforeEach(() => {
    putBody = null;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/admin/packing-list-defaults')) {
        return createJsonResponse({ items: [] });
      }
      if (url.endsWith('/api/admin/packing-list-presets')) {
        return createJsonResponse({
          presets: [
            { key: 'general', label: 'General', isActive: true, items: [{ category: 'Docs', label: 'Passport', position: 0 }] },
            {
              key: 'beach',
              label: 'Beach & Tropical',
              isActive: true,
              items: [{ category: 'Sun Protection', label: 'Sunscreen', position: 0 }],
            },
          ],
        });
      }
      if (url.endsWith('/api/admin/packing-list-presets/beach') && init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body));
        return createJsonResponse({ preset: { key: 'beach', label: 'Beach & Tropical' } });
      }
      return createJsonResponse({});
    });
  });

  test('lets an admin edit and save a preset\'s structured items', async () => {
    const { getByTestId, queryByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="packing-defaults" />
    );

    await waitFor(() => expect(getByTestId('admin-packing-preset-row-beach')).toBeTruthy());

    // General has no edit control (managed by the repository catalog).
    expect(queryByTestId('admin-packing-preset-edit-general')).toBeNull();

    fireEvent.press(getByTestId('admin-packing-preset-edit-beach'));
    await waitFor(() => expect(getByTestId('admin-packing-preset-editor-beach')).toBeTruthy());

    const labelInput = getByTestId('admin-packing-preset-item-label-beach-0');
    fireEvent.changeText(labelInput, 'Reef-safe sunscreen');

    fireEvent.press(getByTestId('admin-packing-preset-item-add-beach'));
    const newCategoryInput = getByTestId('admin-packing-preset-item-category-beach-1');
    const newLabelInput = getByTestId('admin-packing-preset-item-label-beach-1');
    fireEvent.changeText(newCategoryInput, 'Gear');
    fireEvent.changeText(newLabelInput, 'Beach towel');

    fireEvent.press(getByTestId('admin-packing-preset-save-beach'));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.items).toEqual([
      { category: 'Sun Protection', label: 'Reef-safe sunscreen' },
      { category: 'Gear', label: 'Beach towel' },
    ]);

    // The editor closes after a successful save.
    await waitFor(() => expect(queryByTestId('admin-packing-preset-editor-beach')).toBeNull());
  });
});
