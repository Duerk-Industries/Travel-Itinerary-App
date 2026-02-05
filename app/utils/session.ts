const sessionKey = 'stp.session';
const sessionDurationMs = 12 * 60 * 60 * 1000;

const canAccessStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export type StoredSession = {
  token: string;
  name: string;
  email?: string;
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
  expiresAt: number;
};

export const loadSession = (): {
  token: string;
  name: string;
  email?: string;
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
  pageHistory?: string[]
): void => {
  if (!canAccessStorage()) return;
  const payload: StoredSession = {
    token,
    name,
    email: email ?? undefined,
    page,
    pageHistory,
    tripId: tripId ?? undefined,
    expiresAt: Date.now() + sessionDurationMs,
  };
  window.localStorage.setItem(sessionKey, JSON.stringify(payload));
};

export const clearSession = (): void => {
  if (!canAccessStorage()) return;
  window.localStorage.removeItem(sessionKey);
};
