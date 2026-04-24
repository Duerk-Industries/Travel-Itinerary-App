/**
 * @jest-environment node
 */

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

const createJsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: async () => body } as Response);

describe('AdminTab metrics section', () => {
  let metricsCalls: number;

  beforeEach(() => {
    metricsCalls = 0;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin/metrics')) {
        metricsCalls += 1;
        return createJsonResponse({
          counters: {
            'unsplash.url_lookup.cache_hit': 18,
            'unsplash.url_lookup.cache_miss': 2,
            'image.gcs_bytes.cache_hit': 5,
            'image.gcs_bytes.cache_miss': 5,
            'itinerary.generation.success': 7,
          },
          cacheRatios: [
            { namespace: 'image.gcs_bytes', hits: 5, misses: 5, total: 10, hitRate: 0.5 },
            { namespace: 'unsplash.url_lookup', hits: 18, misses: 2, total: 20, hitRate: 0.9 },
          ],
          startedAtIso: '2026-04-24T10:00:00Z',
          snapshotAtIso: '2026-04-24T11:00:00Z',
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  test('renders cache hit-rate rows per namespace and a non-cache counter card', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="metrics" />
    );

    await findByText('Cache hit rates');
    expect(getByTestId('admin-metrics-cache-row-unsplash.url_lookup')).toBeTruthy();
    expect(getByTestId('admin-metrics-cache-row-image.gcs_bytes')).toBeTruthy();
    await findByText('90.0%');
    await findByText('50.0%');
    // Non-cache counter surfaced in the Counters table.
    expect(getByTestId('admin-metrics-counter-itinerary.generation.success')).toBeTruthy();
  });

  test('refresh button refetches /api/admin/metrics', async () => {
    const { findByText, getByTestId } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="metrics" />
    );

    await findByText('Cache hit rates');
    expect(metricsCalls).toBe(1);

    fireEvent.press(getByTestId('admin-metrics-refresh'));
    await waitFor(() => expect(metricsCalls).toBe(2));
  });

  test('shows empty-state copy when there are no cache rollups or counters', async () => {
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin/metrics')) {
        return createJsonResponse({
          counters: {},
          cacheRatios: [],
          startedAtIso: '2026-04-24T10:00:00Z',
          snapshotAtIso: '2026-04-24T11:00:00Z',
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const { findByText } = render(
      <AdminTab backendUrl={backendUrl} headers={headers} initialSection="metrics" />
    );

    await findByText('No cache traffic observed yet on this instance.');
    await findByText('No counter activity on this instance.');
  });
});
