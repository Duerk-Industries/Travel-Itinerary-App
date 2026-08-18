import { getApiCacheSetting } from '../config/apiLimits';
import { createTtlCache } from '../utils/ttlCache';
import { getUnsplashRandomPhoto, searchUnsplashPhotos } from './unsplashApi';
import { logInfo } from '../logger';
import { ApiLimitExceededError } from './usageLimiter';

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

const getNegativeUrlLookupTtlMs = (): number => {
  const configured = getApiCacheSetting('unsplash', 'negativeUrlLookupTtlMs');
  return Number.isFinite(configured) && (configured as number) > 0
    ? configured as number
    : 24 * 60 * 60 * 1000;
};

const urlLookupCache = createTtlCache<string | null>({
  defaultTtlMs: getUrlLookupTtlMs(),
  metricName: 'unsplash.url_lookup',
});

// Once the shared provider limit is reached, avoid attempting every image on
// each overview refresh. The durable hourly limiter remains the source of
// truth; this short local cooldown only turns repeated blocked image requests
// into the normal placeholder path.
const blockedCallerUntil = new Map<string, number>();
const BLOCKED_CALLER_COOLDOWN_MS = 60 * 1000;

const normalizeQuery = (query: string): string => String(query ?? '').trim().toLowerCase();

const buildKey = (caller: string, query: string): string => `${caller}::${normalizeQuery(query)}`;

export const clearUnsplashUrlCache = (): void => {
  urlLookupCache.clear();
  blockedCallerUntil.clear();
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

  const blockedUntil = blockedCallerUntil.get(caller) ?? 0;
  if (blockedUntil > Date.now()) return null;
  if (blockedUntil) blockedCallerUntil.delete(caller);

  const key = buildKey(caller, trimmedQuery);
  return urlLookupCache.getOrFetch(
    key,
    async () => {
      let data: Awaited<ReturnType<typeof searchUnsplashPhotos>>;
      try {
        data = await searchUnsplashPhotos({
          caller,
          accessKey,
          query: trimmedQuery,
          perPage: 1,
          orientation: 'landscape',
        });
      } catch (error) {
        if (error instanceof ApiLimitExceededError && error.name === 'ApiLimitExceededError') {
          blockedCallerUntil.set(caller, Date.now() + BLOCKED_CALLER_COOLDOWN_MS);
          logInfo(`[unsplash] ${caller} is temporarily paused after reaching the provider limit`);
          return null;
        }
        throw error;
      }
      const url = firstRegularUrl(data);
      if (!url) {
        logInfo(`[unsplash] no landscape photo returned for caller=${caller} query="${trimmedQuery}"`);
      }
      return url;
    },
    getUrlLookupTtlMs()
  ).then((url) => {
    // A negative lookup is stable enough to retain for a day, while positive
    // results keep the shorter configured TTL. This avoids retrying a missing
    // destination photo on every overview refresh.
    if (url === null) urlLookupCache.set(key, null, getNegativeUrlLookupTtlMs());
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
