export type AppearancePreference = 'light' | 'dark' | 'auto';
export type ResolvedAppearance = 'light' | 'dark';

export const isAppearancePreference = (value: unknown): value is AppearancePreference =>
  value === 'light' || value === 'dark' || value === 'auto';

const storageKey = 'stp.appearancePreference';

type LocalStorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

const getLocalStorage = (): LocalStorageLike | null => {
  const candidate = (globalThis as any)?.localStorage;
  if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
    return candidate;
  }
  return null;
};

export const loadStoredAppearancePreference = (fallback: AppearancePreference = 'auto'): AppearancePreference => {
  try {
    const storage = getLocalStorage();
    if (storage) {
      const stored = storage.getItem(storageKey);
      if (isAppearancePreference(stored)) return stored;
    }
  } catch {
    // Ignore storage failures.
  }
  return fallback;
};

export const persistAppearancePreference = (pref: AppearancePreference): void => {
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(storageKey, pref);
    }
  } catch {
    // Ignore storage failures.
  }
};

export const resolveAppearance = (
  pref: AppearancePreference,
  systemScheme: 'light' | 'dark' | null | undefined
): ResolvedAppearance => {
  if (pref === 'auto') return systemScheme === 'dark' ? 'dark' : 'light';
  return pref;
};

export const appearanceOptions: Array<{ key: AppearancePreference; label: string }> = [
  { key: 'auto', label: 'Auto' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];
