const sessionKey = 'stp.session';
const sessionTokenKey = 'stp.session.token';
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

const canAccessStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

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

export const loadSession = (): {
  token: string;
  name: string;
  email?: string;
  role?: 'user' | 'admin';
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
} | null => {
  if (!canAccessStorage()) return null;
  try {
    const raw = window.localStorage.getItem(sessionKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredSession;
    if (!data?.token || !data?.name || !data?.expiresAt) return null;
    if (Date.now() > data.expiresAt) {
      window.localStorage.removeItem(sessionKey);
      return null;
    }
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

export const saveSession = (
  token: string,
  name: string,
  page?: string,
  email?: string | null,
  tripId?: string | null,
  pageHistory?: string[],
  role?: 'user' | 'admin'
): void => {
  if (!canAccessStorage()) return;
  const payload: StoredSession = {
    token,
    name,
    email: email ?? undefined,
    role,
    page,
    pageHistory,
    tripId: tripId ?? undefined,
    expiresAt: Date.now() + sessionDurationMs,
  };
  window.localStorage.setItem(sessionKey, JSON.stringify(payload));
  window.localStorage.setItem(sessionTokenKey, token);
};

export const clearSession = (): void => {
  if (!canAccessStorage()) return;
  window.localStorage.removeItem(sessionKey);
  window.localStorage.removeItem(sessionTokenKey);
};
