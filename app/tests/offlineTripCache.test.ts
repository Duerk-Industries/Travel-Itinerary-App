/**
 * @jest-environment node
 */
/// <reference types="jest" />

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OFFLINE_ACCESS_WINDOW_MS,
  clearOfflineTripCache,
  isOfflineAccessValid,
  isTripActiveToday,
  loadOfflineTripCache,
  saveOfflineTripSnapshot,
  startOfflineAccessPeriod,
} from '../utils/offlineTripCache';

describe('offline trip cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('keeps cached trip data scoped to an account for a 30-day access period', async () => {
    const now = Date.UTC(2026, 8, 21, 12, 0, 0);
    const initial = await startOfflineAccessPeriod('Traveler@example.com', now);
    expect(initial?.accessExpiresAt).toBe(now + OFFLINE_ACCESS_WINDOW_MS);

    await saveOfflineTripSnapshot(
      'traveler@example.com',
      {
        tripId: 'trip-1',
        savedAt: now,
        trip: { id: 'trip-1', name: 'Rome' },
        groupMembers: [{ id: 'member-1' }],
        flights: [{ id: 'flight-1' }],
        lodgings: [],
        tours: [],
        carRentals: [],
        expenses: [],
        payments: [],
        coveredBy: {},
        itinerary: null,
      },
      { trips: [{ id: 'trip-1', name: 'Rome' }], groups: [{ id: 'group-1' }] },
    );

    const cached = await loadOfflineTripCache('TRAVELER@example.com');
    expect(cached?.snapshots['trip-1']?.trip).toEqual({ id: 'trip-1', name: 'Rome' });
    expect(isOfflineAccessValid(cached, now + OFFLINE_ACCESS_WINDOW_MS - 1)).toBe(true);
    expect(isOfflineAccessValid(cached, now + OFFLINE_ACCESS_WINDOW_MS)).toBe(false);
    expect(await loadOfflineTripCache('other@example.com')).toBeNull();
  });

  it('retains independent snapshots for the selected trip and other trips available offline', async () => {
    await startOfflineAccessPeriod('traveler@example.com');
    await saveOfflineTripSnapshot(
      'traveler@example.com',
      {
        tripId: 'selected-trip',
        savedAt: Date.now(),
        trip: { id: 'selected-trip', name: 'Selected trip' },
        groupMembers: [{ id: 'member-1' }],
        flights: [], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {},
        itinerary: {
          id: 'itinerary-1',
          planMarkdown: 'Cached trip plan',
          details: [{ id: 'detail-1', day: 1, activity: 'Cached museum visit' }],
        },
      },
      { trips: [{ id: 'selected-trip' }], groups: [{ id: 'group-1' }] },
    );
    await saveOfflineTripSnapshot(
      'traveler@example.com',
      {
        tripId: 'current-trip',
        savedAt: Date.now(),
        trip: { id: 'current-trip', name: 'Current trip' },
        groupMembers: [{ id: 'member-2' }],
        flights: [{ id: 'flight-1' }], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null,
      },
      { trips: [{ id: 'selected-trip' }, { id: 'current-trip' }], groups: [{ id: 'group-1' }, { id: 'group-2' }] },
    );

    const cached = await loadOfflineTripCache('traveler@example.com');
    expect(Object.keys(cached?.snapshots ?? {}).sort()).toEqual(['current-trip', 'selected-trip']);
    expect(cached?.snapshots['selected-trip']?.itinerary).toEqual({
      id: 'itinerary-1',
      planMarkdown: 'Cached trip plan',
      details: [{ id: 'detail-1', day: 1, activity: 'Cached museum visit' }],
    });
    expect(cached?.snapshots['current-trip']?.flights).toEqual([{ id: 'flight-1' }]);
    expect(cached?.trips).toEqual([{ id: 'selected-trip' }, { id: 'current-trip' }]);
  });

  it('removes cached trip data on logout and recognizes a trip active today', async () => {
    await startOfflineAccessPeriod('traveler@example.com');
    await saveOfflineTripSnapshot(
      'traveler@example.com',
      {
        tripId: 'trip-1',
        savedAt: Date.now(),
        trip: { id: 'trip-1' },
        groupMembers: [], flights: [], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null,
      },
      { trips: [], groups: [] },
    );
    expect(isTripActiveToday({ startDate: '2026-09-20', endDate: '2026-09-22' }, new Date(2026, 8, 21))).toBe(true);
    expect(isTripActiveToday({ startDate: '2026-09-22', endDate: '2026-09-25' }, new Date(2026, 8, 21))).toBe(false);

    await clearOfflineTripCache('traveler@example.com');
    expect(await loadOfflineTripCache('traveler@example.com')).toBeNull();
  });
});
