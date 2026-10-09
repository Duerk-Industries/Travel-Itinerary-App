/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  __resetAnalyticsForTests,
  configureAnalytics,
  getAnalyticsQueueForTesting,
  startItemSaveTask,
  taskFailure,
} from '../utils/analytics/track';
import ShareTripModal from '../components/ShareTripModal';
import CsvTransferControls from '../components/CsvTransferControls';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { scheme: 'travelitineraryplanner' } } }));
const mockPickCsvFile = jest.fn();
jest.mock('../utils/dataTransferPlatform', () => ({
  pickCsvFile: (...args: unknown[]) => mockPickCsvFile(...args),
  shareCsvFile: jest.fn(),
}));

// parseCsv measures the file with TextEncoder, which jsdom does not provide.
if (typeof (global as any).TextEncoder === 'undefined') (global as any).TextEncoder = require('util').TextEncoder;

const analyticsFetcher = jest.fn(async () => ({ ok: true, status: 200 }));
const taskEvents = () =>
  getAnalyticsQueueForTesting()
    .filter((e) => e.event_name.startsWith('task_'))
    .map((e) => ({ name: e.event_name, trip: e.trip_id ?? null, ...e.properties }));

let fetchMock: jest.Mock;
beforeEach(() => {
  __resetAnalyticsForTests({ fetcher: analyticsFetcher, now: () => Date.parse('2026-10-08T12:00:00Z') });
  configureAnalytics({ backendUrl: 'http://api.test', token: 'token-1', enabled: true });
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  mockPickCsvFile.mockReset();
});

describe('taskFailure', () => {
  it('maps statuses to the coarse failure categories', () => {
    expect(taskFailure(undefined)).toBe('network');
    expect(taskFailure(0)).toBe('network');
    expect(taskFailure(400)).toBe('validation');
    expect(taskFailure(409)).toBe('validation');
    expect(taskFailure(403)).toBe('permission');
    expect(taskFailure(402)).toBe('quota');
    expect(taskFailure(429)).toBe('quota');
    expect(taskFailure(503)).toBe('server');
    expect(taskFailure(302)).toBe('other');
  });
});

describe('startItemSaveTask', () => {
  it('starts add_item or edit_item and reports only failed requests', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await startItemSaveTask('lodging', false, 'trip-1').request('http://api.test/api/lodgings', { method: 'POST' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    await startItemSaveTask('transfers', true, 'trip-1').request('http://api.test/api/transfers/f1', { method: 'PATCH' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(startItemSaveTask('expenses', true, 'trip-1').request('http://api.test/api/expenses/e1')).rejects.toThrow('Failed to fetch');

    expect(taskEvents()).toEqual([
      { name: 'task_started', trip: 'trip-1', task: 'add_item', feature: 'lodging' },
      { name: 'task_started', trip: 'trip-1', task: 'edit_item', feature: 'transfers' },
      { name: 'task_failed', trip: 'trip-1', task: 'edit_item', feature: 'transfers', failure: 'validation' },
      { name: 'task_started', trip: 'trip-1', task: 'edit_item', feature: 'expenses' },
      { name: 'task_failed', trip: 'trip-1', task: 'edit_item', feature: 'expenses', failure: 'network' },
    ]);
  });

  it('records nothing without consent', async () => {
    configureAnalytics({ backendUrl: 'http://api.test', token: 'token-1', enabled: false });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await startItemSaveTask('lodging', true, 'trip-1').request('http://api.test/api/lodgings/l1');
    expect(getAnalyticsQueueForTesting()).toEqual([]);
  });
});

describe('invite tracking (ShareTripModal)', () => {
  const styles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;
  const renderModal = () =>
    render(
      <ShareTripModal visible backendUrl="http://api.test" headers={{ Authorization: 'Bearer t' }} trip={{ id: 'trip-9', name: 'Lisbon' }} styles={styles} onClose={jest.fn()} />
    );

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    });
  });

  it('tracks a validation failure without sending any email address', async () => {
    const screen = renderModal();
    fireEvent.changeText(screen.getByPlaceholderText(/Enter one or more emails/), 'not-an-email');
    fireEvent.press(screen.getByText('Send Invite'));
    await waitFor(() => expect(taskEvents()).toHaveLength(2));
    expect(taskEvents()).toEqual([
      { name: 'task_started', trip: 'trip-9', task: 'invite', feature: 'collaboration' },
      { name: 'task_failed', trip: 'trip-9', task: 'invite', feature: 'collaboration', failure: 'validation' },
    ]);
    expect(JSON.stringify(getAnalyticsQueueForTesting())).not.toContain('not-an-email');
  });

  it('tracks a server failure from the invite request', async () => {
    const screen = renderModal();
    fireEvent.changeText(screen.getByPlaceholderText(/Enter one or more emails/), 'friend@example.com');
    fireEvent.press(screen.getByText('Send Invite'));
    await waitFor(() => expect(taskEvents()).toHaveLength(2));
    expect(taskEvents()[1]).toMatchObject({ name: 'task_failed', task: 'invite', failure: 'server' });
    expect(JSON.stringify(getAnalyticsQueueForTesting())).not.toContain('friend@example.com');
  });
});

describe('import tracking (CSV)', () => {
  const styles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;

  it('counts a dismissed file picker as a cancelled import', async () => {
    mockPickCsvFile.mockResolvedValueOnce(null);
    const screen = render(
      <CsvTransferControls entity="lodgings" backendUrl="http://api.test" headers={{}} tripId="trip-3" rows={[]} styles={styles} enabledImport />
    );
    fireEvent.press(screen.getByTestId('lodgings-import'));
    await waitFor(() => expect(taskEvents()).toHaveLength(2));
    expect(taskEvents()).toEqual([
      { name: 'task_started', trip: 'trip-3', task: 'import', feature: 'lodging' },
      { name: 'task_cancelled', trip: 'trip-3', task: 'import', feature: 'lodging' },
    ]);
  });

  it('counts an unparseable file as a validation failure', async () => {
    mockPickCsvFile.mockResolvedValueOnce({ text: '"unterminated' });
    const screen = render(
      <CsvTransferControls entity="activities" backendUrl="http://api.test" headers={{}} tripId="trip-3" rows={[]} styles={styles} enabledImport />
    );
    fireEvent.press(screen.getByTestId('activities-import'));
    await waitFor(() => expect(taskEvents()).toHaveLength(2));
    expect(taskEvents()[1]).toMatchObject({ name: 'task_failed', task: 'import', feature: 'activities', failure: 'validation' });
  });
});
