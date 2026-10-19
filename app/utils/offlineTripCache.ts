import { readAsyncOrThrow, removeAsyncOrThrow, writeAsyncOrThrow } from './persistentStorage';

/**
 * This cache deliberately contains only the data needed to render a trip.
 * It is scoped to one signed-in account and never carries a usable server
 * authorization credential. Native access is gated by LocalAuthentication
 * before App.tsx hydrates any of these values.
 */
export type OfflineTripSnapshot = {
  tripId: string;
  bundleEtag?: string;
  bundleCostTracking?: boolean;
  savedAt: number;
  trip: unknown;
  groupMembers: unknown[];
  flights: unknown[];
  lodgings: unknown[];
  tours: unknown[];
  carRentals: unknown[];
  expenses: unknown[];
  payments: unknown[];
  coveredBy: Record<string, string>;
  itinerary: OfflineItinerarySnapshot | null;
};

export type OfflineItinerarySnapshot = {
  id: string | null;
  planMarkdown: string | null;
  details: unknown[];
};

export type OfflineTripCache = {
  version: 2;
  ownerId: string;
  environment: string;
  accessExpiresAt: number;
  savedAt: number;
  trips: unknown[];
  groups: unknown[];
  snapshots: Record<string, OfflineTripSnapshot>;
};

export const OFFLINE_ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'stp.offline-trip-cache.v2';
export type OfflineCacheOwner = { userId: string; environment: string; legacyEmail?: string | null };
const cacheKeyFor = (owner: OfflineCacheOwner): string =>
  `${CACHE_KEY_PREFIX}.${encodeURIComponent(owner.environment)}.${encodeURIComponent(owner.userId)}`;
const validOwner = (owner: OfflineCacheOwner | null | undefined): owner is OfflineCacheOwner =>
  Boolean(owner?.userId && owner?.environment);
// Serialize read/modify/write and logout per owner. Fencing invalidates saves
// started before logout, including a write waiting for native storage to finish.
const operations = new Map<string, Promise<unknown>>();
const epochs = new Map<string, number>();
const serialized = <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  operations.set(key, next);
  void next.finally(() => { if (operations.get(key) === next) operations.delete(key); }).catch(() => undefined);
  return next;
};
const emptyCache = (owner: OfflineCacheOwner, accessExpiresAt: number): OfflineTripCache => ({
  version: 2, ownerId: owner.userId, environment: owner.environment,
  accessExpiresAt, savedAt: Date.now(), trips: [], groups: [], snapshots: {},
});

const validSnapshot = (value: unknown): value is OfflineTripSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<OfflineTripSnapshot>;
  return typeof snapshot.tripId === 'string' && Boolean(snapshot.tripId) && Number.isFinite(snapshot.savedAt)
    && Boolean(snapshot.trip && typeof snapshot.trip === 'object')
    && ['groupMembers', 'flights', 'lodgings', 'tours', 'carRentals', 'expenses', 'payments']
      .every(key => Array.isArray((snapshot as Record<string, unknown>)[key]))
    && Boolean(snapshot.coveredBy && typeof snapshot.coveredBy === 'object' && !Array.isArray(snapshot.coveredBy))
    && (snapshot.itinerary === null || Boolean(snapshot.itinerary && Array.isArray(snapshot.itinerary.details)));
};

const parseCache = (raw: string | null, owner: OfflineCacheOwner): OfflineTripCache | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineTripCache>;
    if (
      parsed?.version !== 2 ||
      parsed.ownerId !== owner.userId ||
      parsed.environment !== owner.environment ||
      !Number.isFinite(parsed.accessExpiresAt) ||
      !Array.isArray(parsed.trips) ||
      !Array.isArray(parsed.groups) ||
      !parsed.snapshots ||
      typeof parsed.snapshots !== 'object' ||
      Array.isArray(parsed.snapshots) ||
      !Object.entries(parsed.snapshots).every(([id, snapshot]) => validSnapshot(snapshot) && snapshot.tripId === id)
    ) {
      return null;
    }
    return parsed as OfflineTripCache;
  } catch {
    return null;
  }
};

const readCache = async (owner: OfflineCacheOwner): Promise<OfflineTripCache | null> =>
  parseCache(await readAsyncOrThrow(cacheKeyFor(owner)), owner);
const writeCache = async (owner: OfflineCacheOwner, cache: OfflineTripCache): Promise<void> => {
  await writeAsyncOrThrow(cacheKeyFor(owner), JSON.stringify(cache));
};

/** Call only after authenticated online sign-in. Old email-only data is not
 * relabeled: it has no immutable owner proof. Download a fresh complete copy. */
export const startOfflineAccessPeriod = async (
  owner: OfflineCacheOwner | null | undefined, now = Date.now(),
): Promise<OfflineTripCache | null> => {
  if (!validOwner(owner)) return null;
  const key = cacheKeyFor(owner);
  const epoch = epochs.get(key) ?? 0;
  return serialized(key, async () => {
    if ((epochs.get(key) ?? 0) !== epoch) return null;
    const current = await readCache(owner);
    const next = { ...(current ?? emptyCache(owner, now + OFFLINE_ACCESS_WINDOW_MS)),
      accessExpiresAt: now + OFFLINE_ACCESS_WINDOW_MS, savedAt: now };
    await writeCache(owner, next);
    return next;
  });
};
export const loadOfflineTripCache = async (owner: OfflineCacheOwner | null | undefined): Promise<OfflineTripCache | null> => {
  if (!validOwner(owner)) return null;
  const key = cacheKeyFor(owner);
  const epoch = epochs.get(key) ?? 0;
  await operations.get(key)?.catch(() => undefined);
  const cache = await readCache(owner);
  return (epochs.get(key) ?? 0) === epoch ? cache : null;
};
export const isOfflineAccessValid = (cache: OfflineTripCache | null, now = Date.now()): boolean =>
  Boolean(cache && cache.accessExpiresAt > now && Object.keys(cache.snapshots).length > 0);

export const saveOfflineTripSnapshot = async (
  owner: OfflineCacheOwner | null | undefined, snapshot: OfflineTripSnapshot,
  catalog: { trips: unknown[]; groups: unknown[] },
): Promise<void> => {
  if (!validOwner(owner)) return;
  if (!validSnapshot(snapshot)) throw new Error('Incomplete offline snapshot');
  const key = cacheKeyFor(owner);
  const epoch = epochs.get(key) ?? 0;
  await serialized(key, async () => {
    if ((epochs.get(key) ?? 0) !== epoch) return;
    const current = await readCache(owner);
    // A stale download cannot recreate a signed-out account's cache.
    if (!current || current.accessExpiresAt <= Date.now()) return;
    const updated: OfflineTripCache = { ...current, savedAt: Date.now(),
      trips: catalog.trips, groups: catalog.groups,
      snapshots: { ...current.snapshots, [snapshot.tripId]: { ...snapshot, savedAt: Date.now() } } };
    await writeCache(owner, updated);
    // Email-only entries cannot prove immutable ownership. Replace them from
    // online data, and remove the legacy copy only after the new commit.
    if (owner.legacyEmail) await removeAsyncOrThrow(`stp.offline-trip-cache.v1.${encodeURIComponent(owner.legacyEmail.trim().toLowerCase())}`);
  });
};
export const clearOfflineTripCache = async (owner: OfflineCacheOwner | null | undefined): Promise<void> => {
  if (!validOwner(owner)) return;
  const key = cacheKeyFor(owner);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
  await serialized(key, async () => {
    await removeAsyncOrThrow(key);
    if (owner.legacyEmail) await removeAsyncOrThrow(`stp.offline-trip-cache.v1.${encodeURIComponent(owner.legacyEmail.trim().toLowerCase())}`);
  });
};

// Local (device) wall-clock date as YYYY-MM-DD — deliberately not `toISOString().slice(0, 10)`,
// which is UTC and can land on the wrong day near midnight in most timezones.
export const localDateString = (date: Date = new Date()): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

export const isTripActiveToday = (trip: { startDate?: string | null; endDate?: string | null }, now = new Date()): boolean => {
  const today = localDateString(now);
  const start = String(trip.startDate ?? '').slice(0, 10);
  const end = String(trip.endDate ?? '').slice(0, 10);
  return Boolean(start && end && start <= today && today <= end);
};
