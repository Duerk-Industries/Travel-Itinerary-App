import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { OfflineSaveButton, OfflineSavePanel, useSaveTripOffline } from '../components/SaveTripOffline';
import OfflineDownloadSettings from '../components/OfflineDownloadSettings';
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
// The button and the panel live in different parts of the screen but share one controller, as in App.tsx.
const Harness = (p: typeof props & { disabled?: boolean }) => {
  const controller = useSaveTripOffline(p);
  return <>
    <OfflineSaveButton controller={controller} />
    <OfflineSavePanel controller={controller} />
  </>;
};
const press = (screen: ReturnType<typeof render>) => fireEvent.press(screen.getByLabelText('Save this trip offline'));

beforeEach(() => {
  Platform.OS = 'web'; jest.clearAllMocks();
  jest.mocked(downloadOfflineTripSnapshot).mockResolvedValue({ tripId: 'trip-a' } as never);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('unknown');
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(false);
  jest.mocked(policy.writeWifiOnlyPreference).mockResolvedValue(undefined);
});

it('shows nothing until a trip is open and the person is signed in', () => {
  const screen = render(<Harness {...props} token="" />);
  expect(screen.queryByLabelText('Save this trip offline')).toBeNull();
  expect(screen.queryByTestId('offline-save-panel')).toBeNull();
});
it('starts from the icon button, asks about the shared device in the panel, and reports success only after storage commits', async () => {
  const screen = render(<Harness {...props} />);
  expect(screen.queryByTestId('offline-save-panel')).toBeNull();
  press(screen);
  expect(await screen.findByText(/Avoid saving on shared devices/)).toBeTruthy();
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save on this device'));
  await waitFor(() => expect(screen.getByText(/Saved up to/)).toBeTruthy());
  expect(cache.saveOfflineTripSnapshot).toHaveBeenCalledWith(props.owner, { tripId: 'trip-a' }, { trips: [], groups: [] });
  fireEvent.press(screen.getByLabelText('Dismiss message'));
  expect(screen.queryByTestId('offline-save-panel')).toBeNull();
});
it('preserves the previous copy and access period after a failed download', async () => {
  jest.mocked(downloadOfflineTripSnapshot).mockRejectedValue(new Error('offline'));
  const screen = render(<Harness {...props} />);
  press(screen); fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(screen.getByText(/Could not save this trip/)).toBeTruthy());
  expect(cache.startOfflineAccessPeriod).not.toHaveBeenCalled();
  expect(cache.saveOfflineTripSnapshot).not.toHaveBeenCalled();
});
it('does nothing while read-only', async () => {
  const screen = render(<Harness {...props} disabled />);
  press(screen);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('offline-save-panel')).toBeNull();
});
it('fences a download finishing after account switch', async () => {
  let finish!: (value: never) => void;
  jest.mocked(downloadOfflineTripSnapshot).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<Harness {...props} />);
  press(screen); fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(downloadOfflineTripSnapshot).toHaveBeenCalled());
  screen.rerender(<Harness {...props} owner={{ ...props.owner, userId: 'owner-b' }} token="token-b" />);
  await act(async () => { finish({ tripId: 'trip-a' } as never); });
  expect(cache.saveOfflineTripSnapshot).not.toHaveBeenCalled();
});
it('still saves on mobile data, but asks first when Wi-Fi only is on in settings', async () => {
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(true);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('metered');
  const screen = render(<Harness {...props} />);
  press(screen);
  expect(await screen.findByText(/You're on mobile data/)).toBeTruthy();
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Save on mobile data'));
  fireEvent.press(await screen.findByText('Save on this device'));
  await waitFor(() => expect(cache.saveOfflineTripSnapshot).toHaveBeenCalled());
});
it('lets the user wait for Wi-Fi', async () => {
  jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(true);
  jest.mocked(policy.getConnectionCost).mockResolvedValue('metered');
  const screen = render(<Harness {...props} />);
  press(screen);
  fireEvent.press(await screen.findByText('Wait for Wi-Fi'));
  expect(downloadOfflineTripSnapshot).not.toHaveBeenCalled();
  expect(screen.queryByTestId('offline-save-panel')).toBeNull();
});
it('does not ask on mobile data when Wi-Fi only is off', async () => {
  jest.mocked(policy.getConnectionCost).mockResolvedValue('metered');
  const screen = render(<Harness {...props} />);
  press(screen);
  expect(await screen.findByText(/Avoid saving on shared devices/)).toBeTruthy();
  expect(screen.queryByText(/You're on mobile data/)).toBeNull();
});

describe('OfflineDownloadSettings (Account settings)', () => {
  const styles = { modalLabel: {}, row: {}, mapOptionButton: {}, mapOptionActive: {}, mapOptionText: {}, mapOptionActiveText: {}, helperText: {} };
  it('shows the saved choice and persists changes', async () => {
    jest.mocked(policy.readWifiOnlyPreference).mockResolvedValue(true);
    const screen = render(<OfflineDownloadSettings styles={styles} />);
    await waitFor(() => expect(screen.getByTestId('offline-wifi-only').props.accessibilityState.selected).toBe(true));
    fireEvent.press(screen.getByTestId('offline-wifi-any'));
    expect(policy.writeWifiOnlyPreference).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('offline-wifi-any').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId('offline-wifi-only'));
    expect(policy.writeWifiOnlyPreference).toHaveBeenLastCalledWith(true);
  });
});
