import { useCallback, useMemo, useRef } from 'react';

type ImageSource = { uri: string };

/**
 * Returns a stable `{ uri }` source object for a given URL. The same URL
 * returns the same object reference across renders so React Native Web's
 * Image component does not restart its load cycle on every parent re-render.
 */
export const useImageSource = (url: string | null | undefined): ImageSource | undefined =>
  useMemo(() => (url ? { uri: url } : undefined), [url]);

/**
 * Returns a getter that produces stable `{ uri }` source objects for any URL.
 * Useful inside render loops where multiple URLs are resolved per render.
 *
 * Caps the cache so a long-lived session that scrolls through many trips /
 * day events can't grow the Map without bound. When the cap is exceeded
 * the oldest insertion is evicted (FIFO via Map iteration order). 500 is
 * well above any realistic trip's image count and keeps the working set in
 * cache; if we ever evict an actively-rendered URL the next render simply
 * allocates a fresh `{ uri }` and re-caches it.
 */
const IMAGE_SOURCE_CACHE_CAP = 500;

export const useImageSourceGetter = () => {
  const cacheRef = useRef<Map<string, ImageSource>>(new Map());
  return useCallback((url: string | null | undefined): ImageSource | undefined => {
    if (!url) return undefined;
    const cache = cacheRef.current;
    const existing = cache.get(url);
    if (existing) return existing;
    const src = { uri: url };
    cache.set(url, src);
    if (cache.size > IMAGE_SOURCE_CACHE_CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return src;
  }, []);
};
