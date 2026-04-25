import { getApiCacheSetting } from '../config/apiLimits';
import { createTtlCache } from '../utils/ttlCache';
import { getUnsplashRandomPhoto, searchUnsplashPhotos } from './unsplashApi';

const UNSPLASH_CALLER_IMAGE_SERVICE_LOCATION = 'IMAGE_SERVICE_LOCATION_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_ITINERARY = 'IMAGE_SERVICE_ITINERARY_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK = 'IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK';
const UNSPLASH_CALLER_HEALTH_CHECK = 'UNSPLASH_HEALTH_CHECK';

const firstRegularUrl = (data: Awaited<ReturnType<typeof searchUnsplashPhotos>>): string | null => {
  const url = data?.results?.[0]?.urls?.regular;
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
};

const getUrlLookupTtlMs = (): number => {
  const raw = getApiCacheSetting('unsplash', 'urlLookupTtlMs');
  if (Number.isFinite(raw) && (raw as number) > 0) return raw as number;
  return 10 * 60 * 1000;
};

const urlLookupCache = createTtlCache<string | null>({
  defaultTtlMs: getUrlLookupTtlMs(),
  metricName: 'unsplash.url_lookup',
});

const normalizeQuery = (query: string): string => String(query ?? '').trim().toLowerCase();

const buildKey = (caller: string, query: string): string => `${caller}::${normalizeQuery(query)}`;

export const clearUnsplashUrlCache = (): void => {
  urlLookupCache.clear();
};

const fetchUnsplashImage = async (
  caller: string,
  accessKey: string,
  locationName: string
): Promise<string | null> => {
  const trimmedQuery = String(locationName ?? '').trim();
  // Empty queries short-circuit before the cache so a one-off bad input
  // never poisons the lookup cache with a permanent null entry.
  if (!trimmedQuery) return null;

  const key = buildKey(caller, trimmedQuery);
  return urlLookupCache.getOrFetch(
    key,
    async () => {
      const data = await searchUnsplashPhotos({
        caller,
        accessKey,
        query: trimmedQuery,
        perPage: 1,
        orientation: 'landscape',
      });
      return firstRegularUrl(data);
    },
    getUrlLookupTtlMs()
  );
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
