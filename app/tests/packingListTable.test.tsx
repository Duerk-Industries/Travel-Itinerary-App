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

    const { findByText, getByText, getByTestId, UNSAFE_getAllByType } = render(
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
    const categoryField = UNSAFE_getAllByType('select' as any)[0];
    expect(categoryField.children.map((option: any) => option.children?.[0])).toEqual(expect.arrayContaining(['Documents', 'Other']));
    fireEvent(categoryField, 'change', { currentTarget: { value: 'Documents' } });
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

  test('edits and immediately persists removal of existing profile packing items', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'item-1', category: 'Documents', label: 'Passport', position: 0 },
          { id: 'item-2', category: 'Clothing', label: 'T-shirt', position: 1 },
        ],
      }),
    } as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ id: 'item-1', category: 'Documents', label: 'ID card', position: 0 }] }),
    } as any);

    const { findByText, getByText, getByTestId, queryByText } = render(
      <PackingListTable backendUrl="http://localhost" headers={{ Authorization: 'Bearer token' }} variant="user" />
    );
    await findByText('Passport');
    fireEvent.press(getByText('Edit'));
    fireEvent.changeText(getByTestId('user-packing-item-item-1'), 'ID card');
    fireEvent.press(getByTestId('user-packing-remove-item-item-2'));

    expect(queryByText('T-shirt')).toBeNull();

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost/api/account/packing-list/item-2',
      expect.objectContaining({ method: 'DELETE' })
    ));
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

  test('renders v2 groups and can add a trip preset', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        groups: [
          { id: 'general', key: 'general', label: 'General', kind: 'preset', items: [{ id: 'heading-artifact', label: 'General', category: 'General', position: 0, packedBy: [] }, { id: 'item-1', label: 'Passport', category: 'Documents', position: 1, packedBy: [] }] },
          { id: 'personal', key: 'personal', label: 'Alex\'s list', kind: 'personal', items: [{ id: 'item-2', label: 'Travel journal', category: 'Personal', position: 1, packedBy: [] }] },
        ],
        travelers: [{ id: 'traveler-1', name: 'Alex' }],
        presets: [{ key: 'beach', label: 'Beach' }],
        tripPresetKeys: [],
      }),
    } as any).mockResolvedValueOnce({ ok: true, json: async () => ({ groups: [{ id: 'beach', key: 'beach', label: 'Beach', kind: 'preset', items: [{ id: 'item-3', label: 'Sun hat', category: 'Beach', position: 0, packedBy: [] }] }], travelers: [{ id: 'traveler-1', name: 'Alex' }], presets: [{ key: 'beach', label: 'Beach' }], tripPresetKeys: ['beach'] }) } as any);

    const { findByText, getByText, getByTestId, queryAllByText } = render(<PackingListTable backendUrl="http://localhost" headers={{ Authorization: 'Bearer token' }} tripId="trip-1" variant="trip" />);
    await waitFor(() => expect(queryAllByText('Documents')).toHaveLength(1));
    await waitFor(() => expect(queryAllByText(/Alex's list/).length).toBeGreaterThan(0));
    expect(getByTestId('trip-packing-preset-scroll').props.style).toEqual(expect.objectContaining({ width: '100%', maxWidth: '100%', flexGrow: 0 }));
    fireEvent.press(getByText('+ Beach'));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('http://localhost/api/trips/trip-1/packing-list/sources', expect.objectContaining({ method: 'PATCH' })));
  });

  test('materializes a user preset into the editable custom list without waiting for the save request', async () => {
    let resolveMaterialize: (value: any) => void = () => {};
    const materializeResponse = new Promise((resolve) => {
      resolveMaterialize = resolve;
    });
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0 }],
        preferences: { presetKeys: ['general'] },
        presets: [{ key: 'men', label: 'Men', items: [{ id: 'men-1', category: 'Clothing', label: 'Polo shirt', position: 0 }] }],
      }),
    } as any).mockImplementationOnce(() => materializeResponse as any);

    const { findByText, getByText, getByTestId, queryByTestId } = render(
      <PackingListTable backendUrl="http://localhost" headers={{ Authorization: 'Bearer token' }} variant="user" />
    );
    await findByText('Passport');

    fireEvent.press(getByText('Men'));

    // Optimistic: the preset's item renders under a synthetic local id immediately,
    // before the background materialize request has resolved.
    expect(getByTestId('user-packing-item-preset-men-men-1')).toBeTruthy();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith('http://localhost/api/account/packing-list-presets/men', expect.objectContaining({ method: 'POST' }))
    );

    // The server assigns fresh, real ids to every item on this write (not just the
    // newly-added one — see replaceUserPackingPreferencesV2). The client must apply
    // that response so its local ids stay valid for later edits/deletes.
    resolveMaterialize({
      ok: true,
      json: async () => ({
        preferences: { presetKeys: ['general'] },
        items: [
          { id: 'item-1', category: 'Documents', label: 'Passport', position: 0 },
          { id: 'server-men-1', category: 'Clothing', label: 'Polo shirt', position: 1 },
        ],
      }),
    });
    await waitFor(() => expect(getByTestId('user-packing-item-server-men-1')).toBeTruthy());
    expect(queryByTestId('user-packing-item-preset-men-men-1')).toBeNull();

    // Deleting the item now targets its real, current server id — and actually persists.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ preferences: { presetKeys: ['general'] }, items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0 }] }),
    } as any);
    fireEvent.press(getByTestId('user-packing-remove-item-server-men-1'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost/api/account/packing-list/server-men-1',
        expect.objectContaining({ method: 'DELETE' })
      )
    );
    expect(queryByTestId('user-packing-item-server-men-1')).toBeNull();
  });

  test('renders without a duplicate-key warning when the same category appears in two non-adjacent runs', async () => {
    // groupedItems only merges *adjacent* same-category items, so a category can
    // legitimately reappear later in the list — e.g. a preset appended at the tail
    // shares a category with an earlier item. Regression test for a real duplicate
    // React key crash ("Travel Gear & Accessories" appearing in two groups).
    jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'item-1', category: 'Travel Gear & Accessories', label: 'Compact jewelry case', position: 0 },
          { id: 'item-2', category: 'Clothing & Footwear', label: 'Shapewear', position: 1 },
          { id: 'item-3', category: 'Travel Gear & Accessories', label: 'Packing cubes', position: 2 },
        ],
        preferences: { presetKeys: ['general'] },
        presets: [],
      }),
    } as any);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { findByText } = render(
      <PackingListTable backendUrl="http://localhost" headers={{ Authorization: 'Bearer token' }} variant="user" />
    );
    await findByText('Compact jewelry case');
    await findByText('Packing cubes');

    const duplicateKeyWarning = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('same key'))
    );
    expect(duplicateKeyWarning).toBe(false);
    errorSpy.mockRestore();
  });
});
