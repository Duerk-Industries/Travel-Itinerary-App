export type MapApp = 'google' | 'apple' | 'waze';

export const isMapApp = (value: unknown): value is MapApp =>
  value === 'google' || value === 'apple' || value === 'waze';

export const buildMapUrl = (address: string, app: MapApp = 'google'): string | null => {
  const query = address?.trim();
  if (!query) return null;
  const encoded = encodeURIComponent(query);
  switch (app) {
    case 'apple':
      return `https://maps.apple.com/?q=${encoded}`;
    case 'waze':
      return `https://www.waze.com/ul?q=${encoded}&navigate=yes`;
    case 'google':
    default:
      return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  }
};

const storageKey = 'stp.mapPreference';

type LocalStorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

const getLocalStorage = (): LocalStorageLike | null => {
  const candidate = (globalThis as any)?.localStorage;
  if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
    return candidate;
  }
  return null;
};

export const loadStoredMapPreference = (fallback: MapApp = 'google'): MapApp => {
  try {
    const storage = getLocalStorage();
    if (storage) {
      const stored = storage.getItem(storageKey);
      if (isMapApp(stored)) return stored;
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
};

export const persistMapPreference = (pref: MapApp) => {
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(storageKey, pref);
    }
  } catch {
    // ignore storage errors
  }
};

export const mapAppOptions: Array<{ key: MapApp; label: string }> = [
  { key: 'google', label: 'Google Maps' },
  { key: 'apple', label: 'Apple Maps' },
  { key: 'waze', label: 'Waze' },
];
