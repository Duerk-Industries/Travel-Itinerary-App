import { readAsync, removeAsync, writeAsync } from './persistentStorage';

/**
 * This cache deliberately contains only the data needed to render a trip.
 * It is scoped to one signed-in account and never carries a usable server
 * authorization credential. Native access is gated by LocalAuthentication
 * before App.tsx hydrates any of these values.
 */
export type OfflineTripSnapshot = {
  tripId: string;
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
  version: 1;
  ownerEmail: string;
  accessExpiresAt: number;
  savedAt: number;
  trips: unknown[];
  groups: unknown[];
  snapshots: Record<string, OfflineTripSnapshot>;
};

export const OFFLINE_ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = 'stp.offline-trip-cache.v1';

const normalizeOwnerEmail = (email: string | null | undefined): string | null => {
  const normalized = String(email ?? '').trim().toLowerCase();
  return normalized || null;
};

const cacheKeyFor = (email: string): string => `${CACHE_KEY_PREFIX}.${encodeURIComponent(email)}`;

const emptyCache = (ownerEmail: string, accessExpiresAt: number): OfflineTripCache => ({
  version: 1,
  ownerEmail,
  accessExpiresAt,
  savedAt: Date.now(),
  trips: [],
  groups: [],
  snapshots: {},
});

const parseCache = (raw: string | null, ownerEmail: string): OfflineTripCache | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineTripCache>;
    if (
      parsed?.version !== 1 ||
      parsed.ownerEmail !== ownerEmail ||
      !Number.isFinite(parsed.accessExpiresAt) ||
      !Array.isArray(parsed.trips) ||
      !Array.isArray(parsed.groups) ||
      !parsed.snapshots ||
      typeof parsed.snapshots !== 'object' ||
      Array.isArray(parsed.snapshots)
    ) {
      return null;
    }
    return parsed as OfflineTripCache;
  } catch {
    return null;
  }
};

const readCache = async (ownerEmail: string): Promise<OfflineTripCache | null> =>
  parseCache(await readAsync(cacheKeyFor(ownerEmail)), ownerEmail);

const writeCache = async (cache: OfflineTripCache): Promise<void> => {
  await writeAsync(cacheKeyFor(cache.ownerEmail), JSON.stringify(cache));
};

/** Starts (or renews after an online sign-in) the 30-day offline access period. */
export const startOfflineAccessPeriod = async (
  email: string | null | undefined,
  now = Date.now(),
): Promise<OfflineTripCache | null> => {
  const ownerEmail = normalizeOwnerEmail(email);
  if (!ownerEmail) return null;
  const current = await readCache(ownerEmail);
  const next: OfflineTripCache = {
    ...(current ?? emptyCache(ownerEmail, now + OFFLINE_ACCESS_WINDOW_MS)),
    ownerEmail,
    accessExpiresAt: now + OFFLINE_ACCESS_WINDOW_MS,
    savedAt: now,
  };
  await writeCache(next);
  return next;
};

/** Returns the account cache even when expired, so callers can enforce the expiry policy. */
export const loadOfflineTripCache = async (
  email: string | null | undefined,
): Promise<OfflineTripCache | null> => {
  const ownerEmail = normalizeOwnerEmail(email);
  return ownerEmail ? readCache(ownerEmail) : null;
};

export const isOfflineAccessValid = (cache: OfflineTripCache | null, now = Date.now()): boolean =>
  Boolean(cache && cache.accessExpiresAt > now && Object.keys(cache.snapshots).length > 0);

export const saveOfflineTripSnapshot = async (
  email: string | null | undefined,
  snapshot: OfflineTripSnapshot,
  catalog: { trips: unknown[]; groups: unknown[] },
): Promise<void> => {
  const ownerEmail = normalizeOwnerEmail(email);
  if (!ownerEmail || !snapshot.tripId) return;
  const current = await readCache(ownerEmail);
  // A snapshot is only useful after a completed online sign-in. The default
  // still covers a first snapshot racing that sign-in's storage write.
  const next = current ?? emptyCache(ownerEmail, Date.now() + OFFLINE_ACCESS_WINDOW_MS);
  const updated: OfflineTripCache = {
    ...next,
    savedAt: Date.now(),
    trips: Array.isArray(catalog.trips) ? catalog.trips : [],
    groups: Array.isArray(catalog.groups) ? catalog.groups : [],
    snapshots: {
      ...next.snapshots,
      [snapshot.tripId]: { ...snapshot, savedAt: Date.now() },
    },
  };
  await writeCache(updated);
};

export const clearOfflineTripCache = async (email: string | null | undefined): Promise<void> => {
  const ownerEmail = normalizeOwnerEmail(email);
  if (!ownerEmail) return;
  await removeAsync(cacheKeyFor(ownerEmail));
};

export const isTripActiveToday = (trip: { startDate?: string | null; endDate?: string | null }, now = new Date()): boolean => {
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const start = String(trip.startDate ?? '').slice(0, 10);
  const end = String(trip.endDate ?? '').slice(0, 10);
  return Boolean(start && end && start <= today && today <= end);
};
