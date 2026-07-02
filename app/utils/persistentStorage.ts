import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Hybrid key/value persistence helpers for code that previously assumed
 * `localStorage`. On web they use `localStorage` synchronously (preserving
 * the original first-render-reads-stored-value semantics). On native they
 * fall back to AsyncStorage, exposed via async helpers that the hooks call
 * from a mount effect to hydrate after the initial render.
 *
 * The sync helpers intentionally return `null` / no-op on native so callers
 * can pass them straight to `useState` initializers without crashing.
 */

export const canAccessWebStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const readSync = (key: string): string | null => {
  if (!canAccessWebStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeSync = (key: string, value: string): void => {
  if (!canAccessWebStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // quota / serialization failures are non-fatal
  }
};

export const removeSync = (key: string): void => {
  if (!canAccessWebStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

export const readAsync = async (key: string): Promise<string | null> => {
  if (canAccessWebStorage()) return readSync(key);
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeAsync = async (key: string, value: string): Promise<void> => {
  if (canAccessWebStorage()) {
    writeSync(key, value);
    return;
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

export const removeAsync = async (key: string): Promise<void> => {
  if (canAccessWebStorage()) {
    removeSync(key);
    return;
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
};
