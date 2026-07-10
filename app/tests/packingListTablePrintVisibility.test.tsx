/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
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

describe('PackingListTable print button on native platforms', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hides the print button on iOS/Android since window.print is unavailable', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        travelers: [{ id: 'traveler-1', name: 'Alex' }],
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0, packedBy: ['traveler-1'] }],
      }),
    } as any);

    const { findByText, queryByTestId } = render(
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
    await waitFor(() => expect(queryByTestId('trip-packing-print')).toBeNull());
  });
});
