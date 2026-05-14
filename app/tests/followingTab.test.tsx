/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import FollowingTab from '../tabs/following';

const styles = {
  bodyText: {},
  button: {},
  dangerButton: {},
  dangerButtonText: {},
  divider: {},
  errorText: {},
  flightTitle: {},
  followTripItem: {},
  headerText: {},
  helperText: {},
  input: {},
  row: {},
  sectionTitle: {},
};

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

const renderFollowingTab = (onRequireLogin = jest.fn()) =>
  render(
    <FollowingTab
      backendUrl="https://api.example.test"
      headers={{ Authorization: 'Bearer token-1' }}
      followedTrips={[{ tripId: 'trip-1', tripName: 'Shared Trip', todayDetails: [] }]}
      styles={styles}
      onRequireLogin={onRequireLogin}
      selectedTripId="trip-1"
      onSelectTrip={jest.fn()}
      onUnfollowTrip={jest.fn()}
    />
  );

describe('FollowingTab', () => {
  beforeEach(() => {
    (globalThis as any).fetch = jest.fn();
  });

  it('does not log out when an auxiliary followed-trip request returns 403', async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() => jsonResponse({ id: 'trip-1', name: 'Shared Trip' }))
      .mockImplementationOnce(() => jsonResponse({ error: 'Not authorized for transfers' }, 403))
      .mockImplementationOnce(() => jsonResponse([]))
      .mockImplementationOnce(() => jsonResponse([]))
      .mockImplementationOnce(() => jsonResponse({ events: [] }))
      .mockImplementationOnce(() => jsonResponse({ comments: [] }))
      .mockImplementationOnce(() => jsonResponse([]));
    const onRequireLogin = jest.fn();

    renderFollowingTab(onRequireLogin);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/api/transfers?tripId=trip-1',
        { headers: { Authorization: 'Bearer token-1' } }
      );
    });
    expect(onRequireLogin).not.toHaveBeenCalled();
  });

  it('logs out when a followed-trip request returns 401', async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() => jsonResponse({ error: 'expired' }, 401))
      .mockImplementationOnce(() => jsonResponse([]))
      .mockImplementationOnce(() => jsonResponse([]))
      .mockImplementationOnce(() => jsonResponse([]))
      .mockImplementationOnce(() => jsonResponse({ events: [] }))
      .mockImplementationOnce(() => jsonResponse({ comments: [] }));
    const onRequireLogin = jest.fn();

    renderFollowingTab(onRequireLogin);

    await waitFor(() => expect(onRequireLogin).toHaveBeenCalledTimes(1));
  });
});
