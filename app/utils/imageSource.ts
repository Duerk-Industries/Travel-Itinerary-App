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
 */
export const useImageSourceGetter = () => {
  const cacheRef = useRef<Map<string, ImageSource>>(new Map());
  return useCallback((url: string | null | undefined): ImageSource | undefined => {
    if (!url) return undefined;
    const cache = cacheRef.current;
    let src = cache.get(url);
    if (!src) {
      src = { uri: url };
      cache.set(url, src);
    }
    return src;
  }, []);
};
