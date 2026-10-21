import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import SaveTripOffline from '../components/SaveTripOffline';
import * as cache from '../utils/offlineTripCache';
import * as policy from '../utils/offlineDownloadPolicy';
import { downloadOfflineTripSnapshot } from '../utils/downloadOfflineTripSnapshot';

jest.mock('../utils/offlineTripCache', () => ({ loadOfflineTripCache: jest.fn(async () => null), startOfflineAccessPeriod: jest.fn(async () => ({})), saveOfflineTripSnapshot: jest.fn(async () => undefined) }));
jest.mock('../utils/offlineDownloadPolicy', () => ({
  ...jest.requireActual('../utils/offlineDownloadPolicy'),
  getConnectionCost: jest.fn(), readWifiOnlyPreference: jest.fn(), writeWifiOnlyPreference: jest.fn(),
}));
jest.mock('../utils/downloadOfflineTripSnapshot', () => ({ downloadOfflineTripSnapshot: jest.fn() }));
const props = { trip: { id: 'trip-a', groupId: 'group-a' }, trips: [], groups: [], owner: { userId: 'owner-a', environment: 'https://api.test' }, token: 'token-a', costTrackingAllowed: false };
beforeEach(() => {
  Platform.OS = 'web'; jest.clearAllMocks();
  jest.mocked(downloadOfflineTripSnapshot).mockResolvedValue({ tripId: 'trip-a' } as never);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('unknown');
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(false);
  jest.mocked(policy.writeWifiOnlyPreference).mockResolvedValue(undefined);
});
it('requires shared-device confirmation and reports success only after storage commits', async () => {
  const screen = render(<SaveTripOffline {...props} />);
  fireEvent.press(screen.getByText('Save this trip offline'));
  expect(await screen.findByText(/Avoid saving on shared devices/)).toBeTruthy();
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save on this device'));
  await waitFor(() => expect(screen.getByText(/Saved up to/)).toBeTruthy());
  expect(cache.saveOfflineTripSnapshot).toHaveBeenCalledWith(props.owner, { tripId: 'trip-a' }, { trips: [], groups: [] });
});
it('preserves the previous copy and access period after a failed download', async () => {
  jest.mocked(downloadOfflineTripSnapshot).mockRejectedValue(new Error('offline'));
  const screen = render(<SaveTripOffline {...props} />);
  fireEvent.press(screen.getByText('Save this trip offline')); fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(screen.getByText(/Could not save this trip/)).toBeTruthy());
  expect(cache.startOfflineAccessPeriod).not.toHaveBeenCalled();
  expect(cache.saveOfflineTripSnapshot).not.toHaveBeenCalled();
});
it('fences a download finishing after account switch', async () => {
  let finish!: (value: never) => void;
  jest.mocked(downloadOfflineTripSnapshot).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<SaveTripOffline {...props} />);
  fireEvent.press(screen.getByText('Save this trip offline')); fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(downloadOfflineTripSnapshot).toHaveBeenCalled());
  screen.rerender(<SaveTripOffline {...props} owner={{ ...props.owner, userId: 'owner-b' }} token="token-b" />);
  await act(async () => { finish({ tripId: 'trip-a' } as never); });
  expect(cache.saveOfflineTripSnapshot).not.toHaveBeenCalled();
});
it('still saves on mobile data, but asks first when Wi-Fi only is on', async () => {
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(true);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('metered');
  const screen = render(<SaveTripOffline {...props} />);
  await waitFor(() => expect(screen.getByLabelText('Download over Wi-Fi only').props.accessibilityState.checked).toBe(true));
  fireEvent.press(screen.getByText('Save this trip offline'));
  expect(await screen.findByText(/You're on mobile data/)).toBeTruthy();
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save on mobile data'));
  fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(cache.saveOfflineTripSnapshot).toHaveBeenCalled());
});
it('lets the user wait for Wi-Fi and remembers the setting', async () => {
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(true);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('metered');
  const screen = render(<SaveTripOffline {...props} />);
  await waitFor(() => expect(screen.getByLabelText('Download over Wi-Fi only').props.accessibilityState.checked).toBe(true));
  fireEvent.press(screen.getByLabelText('Download over Wi-Fi only'));
  expect(policy.writeWifiOnlyPreference).toHaveBeenCalledWith(false);
  fireEvent.press(screen.getByLabelText('Download over Wi-Fi only'));
  expect(policy.writeWifiOnlyPreference).toHaveBeenLastCalledWith(true);
  fireEvent.press(screen.getByText('Save this trip offline'));
  fireEvent.press(await screen.findByText('Wait for Wi-Fi'));
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
});
