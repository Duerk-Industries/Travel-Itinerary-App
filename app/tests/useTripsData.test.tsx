/**
 * @jest-environment node
 */

import React, { useCallback, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useTripsData } from '../hooks/useTripsData';

jest.mock('../utils/session', () => ({
  ...jest.requireActual('../utils/session'),
  loadLastActiveTripId: jest.fn(() => null),
}));

type HarnessParams = {
  initialActiveTripId?: string | null;
  selectedFollowedTripDetails?: any;
  userToken?: string | null;
};

const createJsonResponse = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

const useTripsDataHarness = ({
  initialActiveTripId = null,
  selectedFollowedTripDetails = null,
  userToken = 'token-1',
}: HarnessParams = {}) => {
  const [activeTripId, setActiveTripId] = useState<string | null>(initialActiveTripId);
  const [unauthorizedCount, setUnauthorizedCount] = useState(0);
  const handleUnauthorized = useCallback(() => {
    setUnauthorizedCount((count) => count + 1);
  }, []);
  const hook = useTripsData({
    activeTripId,
    backendUrl: 'https://wanderbunnies.test',
    groupSort: 'created',
    isFollowingMode: Boolean(selectedFollowedTripDetails),
    onUnauthorized: handleUnauthorized,
    requirePasswordSetup: false,
    selectedFollowedTripDetails,
    setActiveTripId,
    userEmail: 'traveler@example.com',
    userToken,
  });

  return { ...hook, activeTripId, setActiveTripId, unauthorizedCount };
};

describe('useTripsData', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches groups and trips and selects the first trip when none is active', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'group-1', name: 'Main Group', ownerId: 'owner-1', createdAt: '2026-01-01', members: [], invites: [] },
        ])
      )
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'trip-1', groupId: 'group-1', groupName: 'Main Group', name: 'Paris', createdAt: '2026-01-01' },
        ])
      )
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'member-1', email: 'traveler@example.com', status: 'active' },
        ])
      );

    const { result } = renderHook(() => useTripsDataHarness());

    await act(async () => {
      await result.current.fetchGroups();
      await result.current.fetchTrips();
    });

    await waitFor(() => {
      expect(result.current.groups).toHaveLength(1);
      expect(result.current.trips).toHaveLength(1);
      expect(result.current.activeTripId).toBe('trip-1');
    });
  });

  it('loads active-trip group members and filters removed members', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'trip-1', groupId: 'group-1', groupName: 'Main Group', name: 'Paris', createdAt: '2026-01-01' },
        ])
      )
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'member-1', email: 'traveler@example.com', status: 'active' },
          { id: 'member-2', email: 'removed@example.com', status: 'removed' },
        ])
      );

    const { result } = renderHook(() => useTripsDataHarness());

    await act(async () => {
      await result.current.fetchTrips();
    });

    await waitFor(() => {
      expect(result.current.groupMembers).toEqual([
        expect.objectContaining({ id: 'member-1', email: 'traveler@example.com', status: 'active' }),
      ]);
    });
  });

  it('does not fetch owner group members while viewing a followed trip', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementationOnce(() =>
      createJsonResponse({ error: 'Not authorized to view group members' }, false, 403)
    );

    const { result } = renderHook(() =>
      useTripsDataHarness({
        initialActiveTripId: 'owned-trip-1',
        selectedFollowedTripDetails: {
          id: 'followed-trip-1',
          groupId: 'owners-group-1',
          name: 'Shared Paris',
        },
      })
    );

    await act(async () => {
      const members = await result.current.fetchGroupMembersForActiveTrip();
      expect(members).toEqual([]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.unauthorizedCount).toBe(0);
    expect(result.current.groupMembers).toEqual([]);
  });

  it('does not log out when an active trip member roster returns 403', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'trip-1', groupId: 'group-1', groupName: 'Shared Group', name: 'Shared Trip', createdAt: '2026-01-01' },
        ])
      )
      .mockImplementationOnce(() =>
        createJsonResponse({ error: 'Not authorized to view group members' }, false, 403)
      );

    const { result } = renderHook(() => useTripsDataHarness({ initialActiveTripId: 'trip-1' }));

    await act(async () => {
      await result.current.fetchTrips();
    });
    await act(async () => {
      const members = await result.current.fetchGroupMembersForActiveTrip();
      expect(members).toEqual([]);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wanderbunnies.test/api/groups/group-1/members',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) })
    );
    expect(result.current.unauthorizedCount).toBe(0);
  });

  it('creates a trip and refreshes the trip list through the shared client flow', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockImplementationOnce(() => createJsonResponse({ id: 'trip-2' }))
      .mockImplementationOnce(() =>
        createJsonResponse([
          { id: 'trip-2', groupId: 'group-9', groupName: 'New Group', name: 'Rome', createdAt: '2026-01-02' },
        ])
      )
      .mockImplementationOnce(() => createJsonResponse([]));

    const { result } = renderHook(() => useTripsDataHarness());

    await act(async () => {
      const response = await result.current.createTrip({ groupId: 'group-9', name: 'Rome' });
      expect(response).toEqual({ ok: true, tripId: 'trip-2' });
    });

    await waitFor(() => {
      expect(result.current.trips).toEqual([
        expect.objectContaining({ id: 'trip-2', name: 'Rome', groupId: 'group-9' }),
      ]);
      expect(result.current.activeTripId).toBe('trip-2');
    });
  });
});
