import { useCallback, useEffect, useRef, useState } from 'react';

const hasWindow = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readStored = <T>(key: string, fallback: T): T => {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStored = (key: string, value: unknown): void => {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota/serialization errors are non-fatal for preference persistence
  }
};

/**
 * Tiny useState wrapper that mirrors value to localStorage under `key`.
 * On first render reads the stored value; otherwise behaves like useState.
 * Falls back to in-memory-only state when localStorage isn't available.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, defaultValue));
  const keyRef = useRef(key);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(readStored(key, defaultValue));
    }
  }, [key, defaultValue]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writeStored(keyRef.current, resolved);
        return resolved;
      });
    },
    []
  );

  return [value, update];
}
