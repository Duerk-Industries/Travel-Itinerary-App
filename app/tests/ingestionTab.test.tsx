/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

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
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
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

const pressTextButton = (node: any) => {
  const pressable = node?.parent;
  if (typeof pressable?.props?.onPress !== 'function') {
    throw new Error(`Expected pressable parent for "${String(node?.props?.children ?? '')}"`);
  }
  pressable.props.onPress();
};

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
      .mockImplementationOnce(() =>
        createJsonResponse({
          jobs: [{ id: 'job-1', state: 'COMPLETED', originalFilename: 'Boston to Los Angeles.pdf', createdAt: '2026-03-18T00:00:00.000Z' }],
        })
      )
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
      );

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
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const polledUrls = fetchMock.mock.calls.slice(4).map((call) => String(call[0]));
    expect(polledUrls).toEqual([
      `${backendUrl}/api/ingestion/jobs`,
      `${backendUrl}/api/ingestion/review-items`,
    ]);
  });

  it('invokes the assignment refresh hook after assigning a hotel review item', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const onAssignmentApplied = jest.fn().mockResolvedValue(undefined);

    const config = {
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

    const hotelItem = {
      id: 'hotel-item-1',
      itemType: 'hotel',
      sourceType: 'MANUAL_UPLOAD',
      providerVendor: 'Booking.com',
      confirmationNumber: 'BOOK123',
      confidenceScore: 0.95,
      status: 'READY_FOR_REVIEW',
      travelerNames: ['Bryan Duerk'],
      startDateTimeUtc: '2026-11-30T00:00:00.000Z',
      extractedFields: { name: 'HANA Boutique hotel' },
    };

    let assigned = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET').toUpperCase();

      if (url.endsWith('/api/ingestion/config')) {
        return createJsonResponse(config);
      }
      if (url.endsWith('/api/ingestion/review-items')) {
        return createJsonResponse({ items: assigned ? [] : [hotelItem] });
      }
      if (url.endsWith('/api/ingestion/jobs')) {
        return createJsonResponse({ jobs: [] });
      }
      if (url.endsWith('/api/ingestion/assignment/trips')) {
        return createJsonResponse({ trips: [{ id: 'trip-1', name: 'Japan Trip' }] });
      }
      if (url.endsWith(`/api/ingestion/review-items/${hotelItem.id}`) && method === 'GET') {
        return createJsonResponse({
          documentSummary: { mimeType: 'application/pdf', originalFilename: 'Chic stay HANA Boutique hotel.pdf' },
          signedDocument: null,
        });
      }
      if (url.endsWith(`/api/ingestion/review-items/${hotelItem.id}/assign`) && method === 'POST') {
        assigned = true;
        return createJsonResponse({ assigned: true });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const { findByText, getAllByText, getByDisplayValue } = render(
      <IngestionTab
        backendUrl={backendUrl}
        headers={headers}
        styles={styles}
        onNavigate={jest.fn()}
        onAssignmentApplied={onAssignmentApplied}
      />
    );

    expect(await findByText('hotel • Booking.com')).toBeTruthy();

    await act(async () => {
      pressTextButton(getAllByText('hotel • Booking.com')[0]);
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${backendUrl}/api/ingestion/review-items/${hotelItem.id}`,
        expect.objectContaining({ headers })
      );
    });

    await act(async () => {
      pressTextButton(getAllByText('Japan Trip')[0]);
    });

    expect(getByDisplayValue('trip-1')).toBeTruthy();

    await act(async () => {
      pressTextButton(getAllByText('Assign')[0]);
    });

    await waitFor(() => {
      expect(onAssignmentApplied).toHaveBeenCalledWith({ itemType: 'hotel', tripId: 'trip-1' });
    });
  });
});

describe('IngestionTab role-based view', () => {
  const baseConfig = {
    tierKey: 'premium',
    quotas: { monthlyUploads: 50, gmailLookbackDays: 30, llmEscalations: 'SMALL_ONLY' },
    forwarding: {
      provider: 'mailgun',
      currentAddress: 'travel.docs@wander-bunnies.com',
      instructions: 'Forward travel confirmations to the Mailgun-backed inbox.',
      adminManagedNote: 'Changing the destination inbox may require an admin update and provider redeploy.',
    },
    gmail: { scope: 'https://www.googleapis.com/auth/gmail.readonly', inboxOnly: true, dryRunSupported: true, connection: { connected: false } },
  };

  const mockLoad = (config: Record<string, unknown>) => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/ingestion/config')) return createJsonResponse(config);
      if (url.endsWith('/api/ingestion/review-items')) return createJsonResponse({ items: [] });
      if (url.endsWith('/api/ingestion/jobs')) return createJsonResponse({ jobs: [] });
      if (url.endsWith('/api/ingestion/assignment/trips')) return createJsonResponse({ trips: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
  };

  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('shows only the forwarding address, Manual Upload, and lists for a regular user — no admin filters, and Gmail Import hidden while its flag is off', async () => {
    mockLoad({ ...baseConfig, features: { manualUpload: true, forwardedMailbox: true, gmailImport: false } });

    const { findByText, queryByText, queryByPlaceholderText } = render(
      <IngestionTab backendUrl={backendUrl} headers={headers} styles={styles} onNavigate={jest.fn()} />
    );

    expect(await findByText('travel.docs@wander-bunnies.com')).toBeTruthy();
    expect(await findByText('Manual Upload')).toBeTruthy();
    expect(await findByText('Queued Items')).toBeTruthy();
    expect(await findByText('Recent Jobs')).toBeTruthy();

    expect(queryByPlaceholderText('Search provider or confirmation')).toBeNull();
    expect(queryByPlaceholderText('Status or ALL')).toBeNull();
    expect(queryByText('Forwarding')).toBeNull();
    expect(queryByText(/adminManagedNote|provider redeploy/)).toBeNull();
    expect(queryByText('Gmail Import')).toBeNull();
  });

  it('shows a simplified Gmail Import section for a regular user when the flag is enabled', async () => {
    mockLoad({ ...baseConfig, features: { manualUpload: true, forwardedMailbox: true, gmailImport: true } });

    const { findByText, queryByText } = render(
      <IngestionTab backendUrl={backendUrl} headers={headers} styles={styles} onNavigate={jest.fn()} />
    );

    expect(await findByText('Gmail Import')).toBeTruthy();
    expect(await findByText('Connect Gmail')).toBeTruthy();
    expect(await findByText('Dry Run')).toBeTruthy();
    expect(await findByText('Import Gmail')).toBeTruthy();
    expect(queryByText(/Scope review/)).toBeNull();
    expect(queryByText(/Inbox only/)).toBeNull();
  });

  it('keeps the full admin view (filters, forwarding detail, and the Gmail-disabled message) for admins', async () => {
    mockLoad({ ...baseConfig, features: { manualUpload: true, forwardedMailbox: true, gmailImport: false } });

    const { findByText, findByPlaceholderText } = render(
      <IngestionTab backendUrl={backendUrl} headers={headers} styles={styles} onNavigate={jest.fn()} userRole="admin" />
    );

    expect(await findByPlaceholderText('Search provider or confirmation')).toBeTruthy();
    expect(await findByPlaceholderText('Status or ALL')).toBeTruthy();
    expect(await findByText('Forwarding')).toBeTruthy();
    expect(await findByText('Gmail import is currently disabled.')).toBeTruthy();
  });
});
