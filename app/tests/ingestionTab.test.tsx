/**
 * @jest-environment node
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import IngestionTab from '../tabs/ingestion';

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
    },
    useWindowDimensions: () => ({ width: 800, height: 600 }),
    useColorScheme: () => 'light',
  };
});

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  button: {},
  buttonText: {},
  input: {},
  section: {},
  warningText: {},
  flightRow: {},
  flightTitle: {},
  modalOverlay: {},
  modalCard: {},
  modalLabel: {},
  navButton: {},
  navButtonText: {},
  tableActionButtonDanger: {},
};

const createJsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);

describe('IngestionTab', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('auto-refreshes while jobs are pending so uploads do not look stuck', async () => {
    const fetchMock = global.fetch as jest.Mock;

    const initialConfig = {
      tierKey: 'pro',
      features: { manualUpload: true, forwardedMailbox: true, gmailImport: false },
      quotas: { monthlyUploads: 500, gmailLookbackDays: 90, llmEscalations: 'LARGE_ALLOWED' },
      forwarding: {
        provider: 'mailgun',
        currentAddress: 'travel.docs@duerk.org',
        instructions: 'Forward travel confirmations here.',
        adminManagedNote: 'Admin managed.',
      },
      gmail: { scope: 'gmail.readonly', inboxOnly: true, dryRunSupported: true, connection: { connected: false } },
    };

    fetchMock
      .mockImplementationOnce(() => createJsonResponse(initialConfig))
      .mockImplementationOnce(() => createJsonResponse({ items: [] }))
      .mockImplementationOnce(() =>
        createJsonResponse({
          jobs: [{ id: 'job-1', state: 'PENDING', originalFilename: 'Boston to Los Angeles.pdf', createdAt: '2026-03-18T00:00:00.000Z' }],
        })
      )
      .mockImplementationOnce(() => createJsonResponse({ trips: [] }))
      .mockImplementationOnce(() => createJsonResponse(initialConfig))
      .mockImplementationOnce(() =>
        createJsonResponse({
          items: [
            {
              id: 'item-1',
              itemType: 'flight',
              sourceType: 'MANUAL_UPLOAD',
              providerVendor: 'American Airlines',
              confirmationNumber: 'ABC123',
              confidenceScore: 0.92,
              status: 'READY_FOR_REVIEW',
              travelerNames: ['Bryan Duerk'],
              startDateTimeUtc: '2026-04-02T14:00:00.000Z',
              extractedFields: { summary: 'Boston to Los Angeles' },
            },
          ],
        })
      )
      .mockImplementationOnce(() =>
        createJsonResponse({
          jobs: [{ id: 'job-1', state: 'COMPLETED', originalFilename: 'Boston to Los Angeles.pdf', createdAt: '2026-03-18T00:00:00.000Z' }],
        })
      )
      .mockImplementationOnce(() => createJsonResponse({ trips: [] }));

    const { findByText, queryByText } = render(
      <IngestionTab backendUrl={backendUrl} headers={headers} styles={styles} onNavigate={jest.fn()} />
    );

    expect(await findByText('Auto-refreshing while uploads process so pending jobs do not appear stuck.')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(queryByText(/PENDING/)).toBeNull();
    });
    expect(await findByText(/COMPLETED/)).toBeTruthy();
    expect(await findByText('flight • American Airlines')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});
