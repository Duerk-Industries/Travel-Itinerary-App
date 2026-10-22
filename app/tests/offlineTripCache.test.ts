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
  touchOfflineTripSnapshot,
} from '../utils/offlineTripCache';

const owner = { userId: 'user-1', environment: 'https://api.example.com' };

describe('offline trip cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('keeps cached trip data scoped to an account for a 30-day access period', async () => {
    const now = Date.now();
    const initial = await startOfflineAccessPeriod(owner, now);
    expect(initial?.accessExpiresAt).toBe(now + OFFLINE_ACCESS_WINDOW_MS);

    await saveOfflineTripSnapshot(
      owner,
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

    const cached = await loadOfflineTripCache(owner);
    expect(cached?.snapshots['trip-1']?.trip).toEqual({ id: 'trip-1', name: 'Rome' });
    expect(isOfflineAccessValid(cached, now + OFFLINE_ACCESS_WINDOW_MS - 1)).toBe(true);
    expect(isOfflineAccessValid(cached, now + OFFLINE_ACCESS_WINDOW_MS)).toBe(false);
    expect(await loadOfflineTripCache({ ...owner, userId: 'user-2' })).toBeNull();
  });

  it('retains independent snapshots for the selected trip and other trips available offline', async () => {
    await startOfflineAccessPeriod(owner);
    await saveOfflineTripSnapshot(
      owner,
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
      owner,
      {
        tripId: 'current-trip',
        savedAt: Date.now(),
        trip: { id: 'current-trip', name: 'Current trip' },
        groupMembers: [{ id: 'member-2' }],
        flights: [{ id: 'flight-1' }], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null,
      },
      { trips: [{ id: 'selected-trip' }, { id: 'current-trip' }], groups: [{ id: 'group-1' }, { id: 'group-2' }] },
    );

    const cached = await loadOfflineTripCache(owner);
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
    await startOfflineAccessPeriod(owner);
    await saveOfflineTripSnapshot(
      owner,
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

    await clearOfflineTripCache(owner);
    expect(await loadOfflineTripCache(owner)).toBeNull();
  });
});


it('bounds saved trips and never evicts unsynced financial work', async () => {
  await AsyncStorage.clear();
  await startOfflineAccessPeriod(owner);
  await AsyncStorage.setItem('stp.pending-expenses.keep', 'unsynced');
  for (let index = 0; index < 7; index += 1) {
    const tripId = `bounded-${index}`;
    await saveOfflineTripSnapshot(owner, { tripId, savedAt: Date.now(), trip: { id: tripId }, groupMembers: [], flights: [], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null }, { trips: [], groups: [] });
  }
  const saved = await loadOfflineTripCache(owner);
  expect(Object.keys(saved!.snapshots)).toHaveLength(5);
  expect(saved!.snapshots['bounded-6']).toBeDefined();
  expect(await AsyncStorage.getItem('stp.pending-expenses.keep')).toBe('unsynced');
  await expect(saveOfflineTripSnapshot(owner, { tripId: 'too-big', savedAt: Date.now(), trip: { id: 'too-big', notes: 'x'.repeat(5_000_001) }, groupMembers: [], flights: [], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null }, { trips: [], groups: [] })).rejects.toThrow('too large');
  expect((await loadOfflineTripCache(owner))!.snapshots).toEqual(saved!.snapshots);
});

const snap = (tripId: string, savedAt = Date.now()) => ({ tripId, savedAt, trip: { id: tripId }, groupMembers: [], flights: [], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null });

it('evicts the least recently opened trip, not the oldest download', async () => {
  await AsyncStorage.clear();
  await startOfflineAccessPeriod(owner);
  for (let index = 0; index < 5; index += 1) await saveOfflineTripSnapshot(owner, snap(`lru-${index}`), { trips: [], groups: [] });
  // lru-0 was downloaded first but opened most recently.
  await touchOfflineTripSnapshot(owner, 'lru-0', Date.now() + 2 * 60 * 60 * 1000);
  await saveOfflineTripSnapshot(owner, snap('lru-5'), { trips: [], groups: [] });
  const ids = Object.keys((await loadOfflineTripCache(owner))!.snapshots).sort();
  expect(ids).toEqual(['lru-0', 'lru-2', 'lru-3', 'lru-4', 'lru-5']);
});

it('falls back to savedAt for snapshots saved before access tracking', async () => {
  await AsyncStorage.clear();
  const now = Date.now();
  await startOfflineAccessPeriod(owner, now);
  const key = `stp.offline-trip-cache.v2.${encodeURIComponent(owner.environment)}.${encodeURIComponent(owner.userId)}`;
  const cache = JSON.parse((await AsyncStorage.getItem(key))!);
  for (let index = 0; index < 5; index += 1) cache.snapshots[`old-${index}`] = snap(`old-${index}`, now - (10 - index) * 1000);
  await AsyncStorage.setItem(key, JSON.stringify(cache));
  await saveOfflineTripSnapshot(owner, snap('new'), { trips: [], groups: [] });
  expect(Object.keys((await loadOfflineTripCache(owner))!.snapshots).sort()).toEqual(['new', 'old-1', 'old-2', 'old-3', 'old-4']);
});

it('touching is throttled, never creates a snapshot and never extends access', async () => {
  await AsyncStorage.clear();
  await touchOfflineTripSnapshot(owner, 'missing');
  expect(await loadOfflineTripCache(owner)).toBeNull();
  const started = await startOfflineAccessPeriod(owner);
  await saveOfflineTripSnapshot(owner, snap('only'), { trips: [], groups: [] });
  const before = (await loadOfflineTripCache(owner))!;
  await touchOfflineTripSnapshot(owner, 'only', Date.now() + 1000);
  expect((await loadOfflineTripCache(owner))!.snapshots.only.lastAccessedAt).toBe(before.snapshots.only.lastAccessedAt);
  await touchOfflineTripSnapshot(owner, 'only', Date.now() + 2 * 60 * 60 * 1000);
  const after = (await loadOfflineTripCache(owner))!;
  expect(after.snapshots.only.lastAccessedAt).toBeGreaterThan(before.snapshots.only.lastAccessedAt!);
  expect(after.accessExpiresAt).toBe(started!.accessExpiresAt);
});
