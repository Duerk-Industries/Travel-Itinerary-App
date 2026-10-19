/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { downloadOfflineTripSnapshot } from '../utils/downloadOfflineTripSnapshot';
import { clearOfflineTripCache, loadOfflineTripCache, saveOfflineTripSnapshot, startOfflineAccessPeriod, type OfflineTripSnapshot } from '../utils/offlineTripCache';

const owner = { userId: 'owner', environment: 'https://example.com' };
const snapshot: OfflineTripSnapshot = {
  tripId: 'trip', trip: { id: 'trip', groupId: 'group' }, savedAt: Date.now(), groupMembers: [],
  flights: [{ id: 'flight' }], lodgings: [], tours: [], carRentals: [], expenses: [], payments: [], coveredBy: {}, itinerary: null,
};
const catalog = { trips: [snapshot.trip], groups: [] };
const originalFetch = global.fetch;
beforeEach(async () => { await AsyncStorage.clear(); await startOfflineAccessPeriod(owner); });
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

it('keeps the complete copy when a transfer fetch fails during refresh', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await saveOfflineTripSnapshot(owner, snapshot, catalog);
  global.fetch = jest.fn(async (url: string) => ({
    ok: !url.includes('/transfers'), status: url.includes('/transfers') ? 503 : 200,
    json: async () => url.includes('covered-by') ? {} : [],
  })) as unknown as typeof fetch;
  await expect(downloadOfflineTripSnapshot({ trip: { id: 'trip', groupId: 'group' }, backendUrl: owner.environment, token: 'token', costTrackingAllowed: true })
    .then(next => saveOfflineTripSnapshot(owner, next, catalog))).rejects.toThrow();
  expect((await loadOfflineTripCache(owner))?.snapshots.trip.flights).toEqual([{ id: 'flight' }]);
});

it('does not replace a saved cache when renewing access cannot read storage', async () => {
  await saveOfflineTripSnapshot(owner, snapshot, catalog);
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(startOfflineAccessPeriod(owner)).rejects.toThrow('storage unavailable');
  expect((await loadOfflineTripCache(owner))?.snapshots.trip.flights).toEqual([{ id: 'flight' }]);
});

it('removes a native write that was already in progress when logout began', async () => {
  const original = AsyncStorage.setItem;
  let release!: () => void;
  let entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    entered(); await gate; await original(key, value);
  });
  const saving = saveOfflineTripSnapshot(owner, snapshot, catalog);
  await writing;
  const clearing = clearOfflineTripCache(owner);
  release();
  await Promise.all([saving, clearing]);
  expect(await loadOfflineTripCache(owner)).toBeNull();
});

it('reports storage-full and leaves the previous complete value readable', async () => {
  await saveOfflineTripSnapshot(owner, snapshot, catalog);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  await expect(saveOfflineTripSnapshot(owner, { ...snapshot, flights: [] }, catalog)).rejects.toThrow('storage full');
  expect((await loadOfflineTripCache(owner))?.snapshots.trip.flights).toEqual([{ id: 'flight' }]);
});

it('serializes concurrent downloads without losing either trip', async () => {
  await Promise.all([
    saveOfflineTripSnapshot(owner, snapshot, catalog),
    saveOfflineTripSnapshot(owner, { ...snapshot, tripId: 'second' }, catalog),
  ]);
  expect(Object.keys((await loadOfflineTripCache(owner))!.snapshots).sort()).toEqual(['second', 'trip']);
  expect(await loadOfflineTripCache({ ...owner, environment: 'https://other.example.com' })).toBeNull();
});

it('fences queued saves at logout and does not recreate access afterward', async () => {
  const saving = saveOfflineTripSnapshot(owner, snapshot, catalog);
  const clearing = clearOfflineTripCache(owner);
  await Promise.all([saving, clearing]);
  await saveOfflineTripSnapshot(owner, snapshot, catalog);
  expect(await loadOfflineTripCache(owner)).toBeNull();
});
