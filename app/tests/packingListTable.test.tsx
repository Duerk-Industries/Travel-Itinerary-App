/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  TouchableHighlight: 'TouchableHighlight',
  View: 'View',
  Image: 'Image',
  ImageBackground: 'ImageBackground',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  Switch: 'Switch',
  Modal: 'Modal',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => styles,
    flatten: (style: unknown) => style,
  },
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 800, height: 600 }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PackingListTable = require('../components/PackingListTable').default as React.FC<any>;

describe('PackingListTable', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders trip items with traveler columns and toggles packed state', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        travelers: [{ id: 'traveler-1', name: 'Alex' }],
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0, packedBy: [] }],
      }),
    } as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as any);

    const { findByText, getByTestId } = render(
      <PackingListTable
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer token' }}
        tripId="trip-1"
        variant="trip"
      />
    );

    expect(await findByText('Documents')).toBeTruthy();
    expect(await findByText('Alex')).toBeTruthy();

    fireEvent.press(getByTestId('packing-check-item-1-traveler-1'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost/api/trips/trip-1/packing-list/checks',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ itemId: 'item-1', travelerId: 'traveler-1', packed: true }),
        })
      );
    });
  });

  test('edits a user default list and saves ordered items', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0 }],
      }),
    } as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'item-1', category: 'Documents', label: 'Passport', position: 0 },
          { id: 'item-2', category: 'Electronics', label: 'Phone charger', position: 1 },
        ],
      }),
    } as any);

    const { findByText, getByText, getByTestId } = render(
      <PackingListTable
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer token' }}
        variant="user"
      />
    );

    expect(await findByText('Passport')).toBeTruthy();
    fireEvent.press(getByText('Edit'));
    fireEvent.press(getByTestId('user-packing-add-item'));
    expect(getByTestId(/^user-packing-item-draft-/)).toBeTruthy();
    fireEvent.changeText(getByTestId(/^user-packing-item-draft-/), 'Phone charger');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost/api/account/packing-list',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Phone charger'),
        })
      );
    });
  });

  test('prints a trip packing list from the table', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        travelers: [{ id: 'traveler-1', name: 'Alex' }],
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0, packedBy: ['traveler-1'] }],
      }),
    } as any);
    const documentMock = { open: jest.fn(), write: jest.fn(), close: jest.fn() };
    const printMock = jest.fn();
    (globalThis as any).open = jest.fn(() => ({ document: documentMock, focus: jest.fn(), print: printMock }));

    const { findByText, getByTestId } = render(
      <PackingListTable
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer token' }}
        tripId="trip-1"
        variant="trip"
        title="Trip packing list"
        allowPrint
      />
    );

    expect(await findByText('Passport')).toBeTruthy();
    fireEvent.press(getByTestId('trip-packing-print'));

    expect(documentMock.write).toHaveBeenCalledWith(expect.stringContaining('Trip packing list'));
    expect(documentMock.write).toHaveBeenCalledWith(expect.stringContaining('Passport'));
    expect(documentMock.write).toHaveBeenCalledWith(expect.stringContaining('@page { size: letter landscape; margin: 0.4in; }'));
    expect(documentMock.write).toHaveBeenCalledWith(expect.stringContaining('border: 1px solid #111827'));
    expect(printMock).toHaveBeenCalled();
    delete (globalThis as any).open;
  });
});
