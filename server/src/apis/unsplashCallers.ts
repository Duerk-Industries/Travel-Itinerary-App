import { getApiCacheSetting } from '../config/apiLimits';
import { createInflightDedupe } from '../utils/inflightDedupe';
import { getUnsplashRandomPhoto, searchUnsplashPhotos } from './unsplashApi';

const UNSPLASH_CALLER_IMAGE_SERVICE_LOCATION = 'IMAGE_SERVICE_LOCATION_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_ITINERARY = 'IMAGE_SERVICE_ITINERARY_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK = 'IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK';
const UNSPLASH_CALLER_HEALTH_CHECK = 'UNSPLASH_HEALTH_CHECK';

const firstRegularUrl = (data: Awaited<ReturnType<typeof searchUnsplashPhotos>>): string | null => {
  const url = data?.results?.[0]?.urls?.regular;
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
};

type UrlCacheEntry = {
  url: string | null;
  expiresAtMs: number;
};

const urlLookupCache = new Map<string, UrlCacheEntry>();
const { dedupe: dedupeUnsplashCall } = createInflightDedupe();

const getUrlLookupTtlMs = (): number => {
  const raw = getApiCacheSetting('unsplash', 'urlLookupTtlMs');
  if (Number.isFinite(raw) && (raw as number) > 0) return raw as number;
  return 10 * 60 * 1000;
};

const normalizeQuery = (query: string): string => String(query ?? '').trim().toLowerCase();

const buildKey = (caller: string, query: string): string => `${caller}::${normalizeQuery(query)}`;

const readFromUrlCache = (key: string): string | null | undefined => {
  const entry = urlLookupCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAtMs <= Date.now()) {
    urlLookupCache.delete(key);
    return undefined;
  }
  return entry.url;
};

const writeToUrlCache = (key: string, url: string | null): void => {
  urlLookupCache.set(key, { url, expiresAtMs: Date.now() + getUrlLookupTtlMs() });
};

export const clearUnsplashUrlCache = (): void => {
  urlLookupCache.clear();
};

const fetchUnsplashImage = async (
  caller: string,
  accessKey: string,
  locationName: string
): Promise<string | null> => {
  const trimmedQuery = String(locationName ?? '').trim();
  if (!trimmedQuery) return null;

  const key = buildKey(caller, trimmedQuery);
  const cachedUrl = readFromUrlCache(key);
  if (cachedUrl !== undefined) return cachedUrl;

  return dedupeUnsplashCall(key, async () => {
    const cachedAfterWait = readFromUrlCache(key);
    if (cachedAfterWait !== undefined) return cachedAfterWait;
    const data = await searchUnsplashPhotos({
      caller,
      accessKey,
      query: trimmedQuery,
      perPage: 1,
      orientation: 'landscape',
    });
    const url = firstRegularUrl(data);
    writeToUrlCache(key, url);
    return url;
  });
};

export const fetchUnsplashImageForLocation = async (
  accessKey: string,
  locationName: string
): Promise<string | null> =>
  fetchUnsplashImage(UNSPLASH_CALLER_IMAGE_SERVICE_LOCATION, accessKey, locationName);

export const fetchUnsplashImageForItinerary = async (
  accessKey: string,
  locationName: string
): Promise<string | null> =>
  fetchUnsplashImage(UNSPLASH_CALLER_IMAGE_SERVICE_ITINERARY, accessKey, locationName);

export const fetchUnsplashImageForGooglePlaceFallback = async (
  accessKey: string,
  locationName: string
): Promise<string | null> =>
  fetchUnsplashImage(UNSPLASH_CALLER_IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK, accessKey, locationName);

export const requestUnsplashHealthCheck = async (params: {
  accessKey: string;
  timeoutMs: number;
  validateStatus: (status: number) => boolean;
}) => {
  return getUnsplashRandomPhoto({
    caller: UNSPLASH_CALLER_HEALTH_CHECK,
    accessKey: params.accessKey,
    timeoutMs: params.timeoutMs,
    validateStatus: params.validateStatus,
  });
};
