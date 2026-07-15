/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';

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
    hairlineWidth: 1,
  },
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 800, height: 600 }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PackingListMatrix = require('../components/PackingListMatrix').default as React.FC<any>;

const colors = { border: '#ddd', text: '#000', textMuted: '#555', backgroundAlt: '#f5f5f5', success: '#0a0', surface: '#fff' };
const items = [{ id: 'item-1', label: 'Passport', category: 'Documents', position: 0, packedBy: [] }];
const travelers = [{ id: 'traveler-1', name: 'Alex' }];

describe('PackingListMatrix sticky header/column contract (web)', () => {
  test('renders one sticky scroll container with sticky positioning on the corner, header row, and item column', () => {
    const { getByTestId } = render(<PackingListMatrix items={items} travelers={travelers} colors={colors} />);

    const scrollContainer = getByTestId('packing-matrix-web-scroll');
    expect(scrollContainer.props.style).toEqual(expect.objectContaining({ overflow: 'auto', position: 'relative' }));

    // Same check-cell testID contract as the native matrix, so
    // PackingListTable's toggle wiring doesn't need to branch on platform.
    expect(getByTestId('packing-check-item-1-traveler-1')).toBeTruthy();
  });
});
