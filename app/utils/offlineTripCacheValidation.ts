import type { OfflineTripSnapshot, OfflineTripCache, OfflineCacheOwner } from './offlineTripCache';

export const validSnapshot = (value: unknown): value is OfflineTripSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<OfflineTripSnapshot>;
  return typeof snapshot.tripId === 'string' && Boolean(snapshot.tripId) && Number.isFinite(snapshot.savedAt)
    && Boolean(snapshot.trip && typeof snapshot.trip === 'object')
    && ['groupMembers', 'flights', 'lodgings', 'tours', 'carRentals', 'expenses', 'payments']
      .every(key => Array.isArray((snapshot as Record<string, unknown>)[key]))
    && Boolean(snapshot.coveredBy && typeof snapshot.coveredBy === 'object' && !Array.isArray(snapshot.coveredBy))
    && (snapshot.itinerary === null || Boolean(snapshot.itinerary && Array.isArray(snapshot.itinerary.details)));
};

export const parseCache = (raw: string | null, owner: OfflineCacheOwner): OfflineTripCache | null => {
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

