import { useCallback, useEffect, useRef, useState } from 'react';
import { canAccessWebStorage, readAsync, readSync, writeAsync, writeSync } from '../utils/persistentStorage';

const parseStored = <T>(raw: string | null, fallback: T): T => {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readInitial = <T>(key: string, fallback: T): T =>
  parseStored(readSync(key), fallback);

/**
 * Tiny useState wrapper that mirrors value to persistent storage under `key`.
 *
 * On web, reads `localStorage` synchronously on first render. On native,
 * the initial render uses `defaultValue` and then a mount effect hydrates
 * the value from AsyncStorage if one was stored.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readInitial(key, defaultValue));
  const keyRef = useRef(key);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(readInitial(key, defaultValue));
    }
  }, [key, defaultValue]);

  // Native hydration: the synchronous read above returns the fallback on
  // native; pull the persisted value asynchronously and adopt it if found.
  useEffect(() => {
    if (canAccessWebStorage()) return;
    let cancelled = false;
    void (async () => {
      const raw = await readAsync(key);
      if (cancelled || raw === null) return;
      try {
        const parsed = JSON.parse(raw) as T;
        setValue(parsed);
      } catch {
        // ignore corrupt entries
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        const serialized = JSON.stringify(resolved);
        if (canAccessWebStorage()) {
          writeSync(keyRef.current, serialized);
        } else {
          void writeAsync(keyRef.current, serialized);
        }
        return resolved;
      });
    },
    []
  );

  return [value, update];
}
