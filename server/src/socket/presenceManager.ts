/**
 * In-process presence manager.
 *
 * Tracks which users are "online" in each trip room.
 * An offline grace period of 15 seconds prevents flicker on brief disconnects.
 *
 * NOTE: This is an in-memory implementation suitable for a single-process
 * deployment. A Redis adapter would be required for multi-instance scaling.
 */
import { colorForUser, initialsForName } from '@wanderbunnies/messaging';
import type { PresenceUser } from '@wanderbunnies/messaging';

interface PresenceEntry extends PresenceUser {
  offlineTimer?: ReturnType<typeof setTimeout>;
}

/** tripId → Map<userId, PresenceEntry> */
const tripPresence = new Map<string, Map<string, PresenceEntry>>();

const OFFLINE_GRACE_MS = 15_000;

const getOrCreateTrip = (tripId: string): Map<string, PresenceEntry> => {
  if (!tripPresence.has(tripId)) tripPresence.set(tripId, new Map());
  return tripPresence.get(tripId)!;
};

export const userJoined = (
  tripId: string,
  userId: string,
  displayName: string,
): PresenceUser[] => {
  const room = getOrCreateTrip(tripId);

  // Cancel any pending offline timer
  const existing = room.get(userId);
  if (existing?.offlineTimer) {
    clearTimeout(existing.offlineTimer);
  }

  const entry: PresenceEntry = {
    userId,
    displayName,
    initials: initialsForName(displayName),
    color: colorForUser(userId),
    lastSeen: new Date().toISOString(),
  };
  room.set(userId, entry);

  return presenceList(tripId);
};

export const userLeft = (
  tripId: string,
  userId: string,
  onOffline: (list: PresenceUser[]) => void,
): void => {
  const room = tripPresence.get(tripId);
  if (!room) return;

  const existing = room.get(userId);
  if (!existing) return;

  // Clear any prior timer
  if (existing.offlineTimer) clearTimeout(existing.offlineTimer);

  // Grace period before removing
  existing.offlineTimer = setTimeout(() => {
    const r = tripPresence.get(tripId);
    if (r) {
      r.delete(userId);
      if (r.size === 0) tripPresence.delete(tripId);
    }
    onOffline(presenceList(tripId));
  }, OFFLINE_GRACE_MS);
};

export const heartbeat = (tripId: string, userId: string): void => {
  const room = tripPresence.get(tripId);
  if (!room) return;
  const entry = room.get(userId);
  if (!entry) return;
  entry.lastSeen = new Date().toISOString();
};

export const presenceList = (tripId: string): PresenceUser[] => {
  const room = tripPresence.get(tripId);
  if (!room) return [];
  return Array.from(room.values()).map(({ offlineTimer: _t, ...rest }) => rest);
};

/** For testing only — clear all state. */
export const _reset = (): void => {
  for (const [, room] of tripPresence) {
    for (const entry of room.values()) {
      if (entry.offlineTimer) clearTimeout(entry.offlineTimer);
    }
  }
  tripPresence.clear();
};
