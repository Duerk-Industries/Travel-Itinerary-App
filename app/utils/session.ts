import AsyncStorage from '@react-native-async-storage/async-storage';

const sessionKey = 'stp.session';
const sessionTokenKey = 'stp.session.token';
const lastTripByEmailKey = 'stp.session.lastTripByEmail';
const asyncItineraryByEmailKey = 'stp.session.asyncItinerary';

const resolveSessionDurationMs = (): number => {
  const raw =
    process.env.EXPO_PUBLIC_SESSION_CACHE_TIMEOUT_MINUTES ??
    process.env.SESSION_CACHE_TIMEOUT_MINUTES ??
    '720';
  const minutes = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return 12 * 60 * 60 * 1000;
  return Math.floor(minutes) * 60 * 1000;
};

const sessionDurationMs = resolveSessionDurationMs();

const canAccessWebStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizeTripOwnerKey = (email?: string | null): string | null => {
  const normalized = String(email ?? '').trim().toLowerCase();
  return normalized || null;
};

const parseLastTripMap = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const loadLastTripMap = (): Record<string, string> => {
  if (!canAccessWebStorage()) return {};
  return parseLastTripMap(window.localStorage.getItem(lastTripByEmailKey));
};

const saveLastTripMap = (lastTrips: Record<string, string>): void => {
  if (!canAccessWebStorage()) return;
  window.localStorage.setItem(lastTripByEmailKey, JSON.stringify(lastTrips));
};

const loadLastTripMapAsync = async (): Promise<Record<string, string>> => {
  if (canAccessWebStorage()) return loadLastTripMap();
  try {
    return parseLastTripMap(await AsyncStorage.getItem(lastTripByEmailKey));
  } catch {
    return {};
  }
};

const saveLastTripMapAsync = async (lastTrips: Record<string, string>): Promise<void> => {
  if (canAccessWebStorage()) {
    saveLastTripMap(lastTrips);
    return;
  }
  try {
    await AsyncStorage.setItem(lastTripByEmailKey, JSON.stringify(lastTrips));
  } catch {
    // Ignore storage failures; session persistence is best effort.
  }
};

// Pending/failed/completed AI itinerary generation jobs, persisted separately from the
// main session blob (and keyed by email like lastTripByEmail) so a page refresh doesn't
// lose the "generating..." banner, and one user's browser session can't see another's.
const parseAsyncItineraryByEmailMap = (raw: string | null): Record<string, Record<string, unknown>> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, Record<string, unknown>>;
  } catch {
    return {};
  }
};

const loadAsyncItineraryByEmailMap = (): Record<string, Record<string, unknown>> => {
  if (!canAccessWebStorage()) return {};
  return parseAsyncItineraryByEmailMap(window.localStorage.getItem(asyncItineraryByEmailKey));
};

const saveAsyncItineraryByEmailMap = (value: Record<string, Record<string, unknown>>): void => {
  if (!canAccessWebStorage()) return;
  window.localStorage.setItem(asyncItineraryByEmailKey, JSON.stringify(value));
};

const loadAsyncItineraryByEmailMapAsync = async (): Promise<Record<string, Record<string, unknown>>> => {
  if (canAccessWebStorage()) return loadAsyncItineraryByEmailMap();
  try {
    return parseAsyncItineraryByEmailMap(await AsyncStorage.getItem(asyncItineraryByEmailKey));
  } catch {
    return {};
  }
};

const saveAsyncItineraryByEmailMapAsync = async (value: Record<string, Record<string, unknown>>): Promise<void> => {
  if (canAccessWebStorage()) {
    saveAsyncItineraryByEmailMap(value);
    return;
  }
  try {
    await AsyncStorage.setItem(asyncItineraryByEmailKey, JSON.stringify(value));
  } catch {
    // Ignore storage failures; this is a best-effort UX nicety.
  }
};

export const loadAsyncItineraryByTrip = (email?: string | null): Record<string, unknown> => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return {};
  return loadAsyncItineraryByEmailMap()[ownerKey] ?? {};
};

export const loadAsyncItineraryByTripAsync = async (email?: string | null): Promise<Record<string, unknown>> => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return {};
  const all = await loadAsyncItineraryByEmailMapAsync();
  return all[ownerKey] ?? {};
};

export const saveAsyncItineraryByTrip = (value: Record<string, unknown>, email?: string | null): void => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return;
  const all = loadAsyncItineraryByEmailMap();
  if (value && Object.keys(value).length) {
    all[ownerKey] = value;
  } else {
    delete all[ownerKey];
  }
  saveAsyncItineraryByEmailMap(all);
};

export const saveAsyncItineraryByTripAsync = async (value: Record<string, unknown>, email?: string | null): Promise<void> => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return;
  const all = await loadAsyncItineraryByEmailMapAsync();
  if (value && Object.keys(value).length) {
    all[ownerKey] = value;
  } else {
    delete all[ownerKey];
  }
  await saveAsyncItineraryByEmailMapAsync(all);
};

export type StoredSession = {
  token: string;
  name: string;
  email?: string;
  role?: 'user' | 'admin';
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
  expiresAt: number;
};

export type LoadedSession = {
  token: string;
  name: string;
  email?: string;
  role?: 'user' | 'admin';
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
} | null;

const parseStoredSession = (raw: string | null): LoadedSession => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as StoredSession;
    if (!data?.token || !data?.name || !data?.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;
    return {
      token: data.token,
      name: data.name,
      email: data.email,
      role: data.role,
      page: data.page,
      pageHistory: Array.isArray(data.pageHistory) ? data.pageHistory : undefined,
      tripId: data.tripId ?? null,
    };
  } catch {
    return null;
  }
};

export const loadSession = (): LoadedSession => {
  if (!canAccessWebStorage()) return null;
  const raw = window.localStorage.getItem(sessionKey);
  const parsed = parseStoredSession(raw);
  if (!parsed && raw) {
    window.localStorage.removeItem(sessionKey);
    window.localStorage.removeItem(sessionTokenKey);
  }
  return parsed;
};

export const loadSessionAsync = async (): Promise<LoadedSession> => {
  if (canAccessWebStorage()) return loadSession();
  try {
    const raw = await AsyncStorage.getItem(sessionKey);
    const parsed = parseStoredSession(raw);
    if (!parsed && raw) {
      await AsyncStorage.removeItem(sessionKey);
      await AsyncStorage.removeItem(sessionTokenKey);
    }
    return parsed;
  } catch {
    return null;
  }
};

const buildSessionPayload = (
  token: string,
  name: string,
  page?: string,
  email?: string | null,
  tripId?: string | null,
  pageHistory?: string[],
  role?: 'user' | 'admin'
): StoredSession => ({
  token,
  name,
  email: email ?? undefined,
  role,
  page,
  pageHistory,
  tripId: tripId ?? undefined,
  expiresAt: Date.now() + sessionDurationMs,
});

export const saveSession = (
  token: string,
  name: string,
  page?: string,
  email?: string | null,
  tripId?: string | null,
  pageHistory?: string[],
  role?: 'user' | 'admin'
): void => {
  if (!canAccessWebStorage()) return;
  const payload = buildSessionPayload(token, name, page, email, tripId, pageHistory, role);
  window.localStorage.setItem(sessionKey, JSON.stringify(payload));
  window.localStorage.setItem(sessionTokenKey, token);
  saveLastActiveTripId(tripId ?? null, email ?? undefined);
};

export const saveSessionAsync = async (
  token: string,
  name: string,
  page?: string,
  email?: string | null,
  tripId?: string | null,
  pageHistory?: string[],
  role?: 'user' | 'admin'
): Promise<void> => {
  if (canAccessWebStorage()) {
    saveSession(token, name, page, email, tripId, pageHistory, role);
    return;
  }
  const payload = buildSessionPayload(token, name, page, email, tripId, pageHistory, role);
  try {
    await AsyncStorage.setItem(sessionKey, JSON.stringify(payload));
    await AsyncStorage.setItem(sessionTokenKey, token);
    await saveLastActiveTripIdAsync(tripId ?? null, email ?? undefined);
  } catch {
    // Ignore storage failures; the in-memory session remains active.
  }
};

export const clearSession = (): void => {
  if (!canAccessWebStorage()) return;
  window.localStorage.removeItem(sessionKey);
  window.localStorage.removeItem(sessionTokenKey);
};

export const clearSessionAsync = async (): Promise<void> => {
  if (canAccessWebStorage()) {
    clearSession();
    return;
  }
  try {
    await AsyncStorage.removeItem(sessionKey);
    await AsyncStorage.removeItem(sessionTokenKey);
  } catch {
    // Ignore storage failures.
  }
};

export const loadLastActiveTripId = (email?: string | null): string | null => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return null;
  const lastTrips = loadLastTripMap();
  return lastTrips[ownerKey] ?? null;
};

export const loadLastActiveTripIdAsync = async (email?: string | null): Promise<string | null> => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return null;
  const lastTrips = await loadLastTripMapAsync();
  return lastTrips[ownerKey] ?? null;
};

export const saveLastActiveTripId = (tripId?: string | null, email?: string | null): void => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return;
  const lastTrips = loadLastTripMap();
  if (tripId && tripId.trim()) {
    lastTrips[ownerKey] = tripId;
  } else {
    delete lastTrips[ownerKey];
  }
  saveLastTripMap(lastTrips);
};

export const saveLastActiveTripIdAsync = async (tripId?: string | null, email?: string | null): Promise<void> => {
  const ownerKey = normalizeTripOwnerKey(email);
  if (!ownerKey) return;
  const lastTrips = await loadLastTripMapAsync();
  if (tripId && tripId.trim()) {
    lastTrips[ownerKey] = tripId;
  } else {
    delete lastTrips[ownerKey];
  }
  await saveLastTripMapAsync(lastTrips);
};
