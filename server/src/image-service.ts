import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import { getEnvValue } from './env';
import { getApiCacheSetting } from './config/apiLimits';
import { createTtlCache } from './utils/ttlCache';
import {
  fetchUnsplashImageForGooglePlaceFallback,
  fetchUnsplashImageForItinerary,
  fetchUnsplashImageForLocation,
} from './apis/unsplashCallers';
import { logError, logInfo } from './logger';

const bucketName = process.env.LOCATION_BUCKET || 'duerk-travel-itinerary-app-location-data';
const CACHE_TTL_MS =
  Number(getApiCacheSetting('images', 'cacheTtlMs')) ||
  Number(process.env.IMAGE_CACHE_TTL_MS) ||
  1000 * 60 * 60 * 24 * 7;
const SIGNED_URL_TTL_MS = Number(getApiCacheSetting('images', 'signedUrlTtlMs')) || 1000 * 60 * 60;
let storage: Storage | null = null;
let imageCacheDisabledReason: string | null = null;
let imageCacheDisableLogged = false;

const gcsSignedUrlCache = createTtlCache<string | null>({
  defaultTtlMs: SIGNED_URL_TTL_MS,
  metricName: 'image.gcs_bytes',
});

export const clearImageServiceCachesForTests = (): void => {
  gcsSignedUrlCache.clear();
  storage = null;
  imageCacheDisabledReason = null;
  imageCacheDisableLogged = false;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

const normalizeQueryKey = (value: string): string =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const stopwords = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'at',
  'in',
  'of',
  'for',
  'to',
  'with',
  'by',
  'on',
  'from',
  'day',
  'trip',
]);

const tokenize = (value: string): string[] =>
  normalizeQueryKey(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !stopwords.has(token));

export const computePlaceMatchLikelihood = (query: string, candidate: string): number => {
  const queryTokens = new Set(tokenize(query));
  const candidateTokens = new Set(tokenize(candidate));
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) intersection += 1;
  }
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  if (!union) return 0;
  return Math.max(0, Math.min(1, intersection / union));
};

const getUnsplashAccessKeyOrThrow = (): string => {
  const accessKey = getEnvValue('UNSPLASH_ACCESS_KEY');
  if (!accessKey) {
    logInfo('[unsplash] UNSPLASH_ACCESS_KEY is not configured; using the client placeholder fallback');
    throw new Error('Unsplash Access Key is not configured.');
  }
  return accessKey;
};

const isMissingDefaultCredentialsError = (error: unknown): boolean =>
  String(error instanceof Error ? error.message : error ?? '').includes('Could not load the default credentials');

const isGcsSigningCredentialsError = (error: unknown): boolean => {
  const message = String(error instanceof Error ? error.message : error ?? '');
  const name = error instanceof Error ? error.name : '';
  return name === 'SigningError' || message.includes('Cannot sign data without `client_email`');
};

const disableImageCache = (reason: string) => {
  imageCacheDisabledReason = reason;
  if (!imageCacheDisableLogged) {
    console.warn(`Image cache disabled: ${reason}`);
    imageCacheDisableLogged = true;
  }
};

const getBucket = () => {
  if (imageCacheDisabledReason) return null;
  storage ??= new Storage();
  return storage.bucket(bucketName);
};

async function readCachedImageUrlFromGcs(filepath: string): Promise<string | null> {
  const bucket = getBucket();
  if (!bucket) return null;
  try {
    const file = bucket.file(filepath);
    const [exists] = await file.exists();
    if (!exists) return null;

    const [metadata] = await file.getMetadata();
    const created = new Date(metadata.timeCreated!).getTime();
    if (Date.now() - created > CACHE_TTL_MS) {
      return null;
    }

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  } catch (error) {
    if (isMissingDefaultCredentialsError(error)) {
      disableImageCache('Google Cloud default credentials are unavailable in this environment');
      return null;
    }
    if (isGcsSigningCredentialsError(error)) {
      disableImageCache('Google Cloud credentials cannot sign cached image URLs in this environment');
      return null;
    }
    console.error('Error checking cache:', error);
    return null;
  }
}

async function getCachedImageUrl(filepath: string): Promise<string | null> {
  return gcsSignedUrlCache.getOrFetch(
    filepath,
    () => readCachedImageUrlFromGcs(filepath),
    SIGNED_URL_TTL_MS
  );
}

async function cacheImage(filepath: string, imageUrl: string): Promise<string> {
  const bucket = getBucket();
  if (!bucket) return imageUrl;
  try {
    const file = bucket.file(filepath);
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const contentTypeHeader = response.headers['content-type'];
    const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined;

    await new Promise((resolve, reject) => {
      response.data
        .pipe(
          file.createWriteStream({
            metadata: {
              contentType,
            },
          })
        )
        .on('error', reject)
        .on('finish', resolve);
    });

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  } catch (error) {
    if (isMissingDefaultCredentialsError(error)) {
      disableImageCache('Google Cloud default credentials are unavailable in this environment');
      return imageUrl;
    }
    if (isGcsSigningCredentialsError(error)) {
      disableImageCache('Google Cloud credentials cannot sign cached image URLs in this environment');
      return imageUrl;
    }
    console.error('Error caching image:', error);
    return imageUrl;
  }
}

type CachedResult = { url: string; cached: boolean };

const fetchAndCache = async (cachePath: string, fetcher: () => Promise<string>): Promise<CachedResult> => {
  const cachedUrl = await getCachedImageUrl(cachePath);
  if (cachedUrl) return { url: cachedUrl, cached: true };
  const imageUrl = await fetcher();
  if (!imageUrl) return { url: '', cached: false };
  const cached = await cacheImage(cachePath, imageUrl);
  if (cached && cached !== imageUrl) {
    gcsSignedUrlCache.set(cachePath, cached, SIGNED_URL_TTL_MS);
  } else {
    gcsSignedUrlCache.delete(cachePath);
  }
  return { url: cached, cached: false };
};

const fetchUnsplashImageNoCache = async (locationName: string): Promise<string> => {
  const accessKey = getUnsplashAccessKeyOrThrow();
  const imageUrl = await fetchUnsplashImageForLocation(accessKey, locationName);
  if (!imageUrl) {
    throw new Error('No photos found for the location on Unsplash.');
  }
  return imageUrl;
};

// Kept for compatibility: Google Places is disabled, so this now falls back to Unsplash.
export async function getGooglePlaceImage(locationName: string, placeId?: string): Promise<string> {
  void placeId;
  const fallbackQuery = String(locationName ?? '').trim() || 'travel destination';
  const accessKey = getUnsplashAccessKeyOrThrow();
  const imageUrl = await fetchUnsplashImageForGooglePlaceFallback(accessKey, fallbackQuery);
  if (!imageUrl) {
    throw new Error('No photos found for the location on Unsplash.');
  }
  return imageUrl;
}

export async function getUnsplashImage(locationName: string): Promise<string> {
  const filename = sanitizeFilename(locationName);
  const cachePath = `unsplash/${filename}.jpg`;
  const result = await fetchAndCache(cachePath, () => fetchUnsplashImageNoCache(locationName));
  return result.url;
}

export async function getItineraryImage(params: {
  locationName: string;
  day?: string;
  placeId?: string;
  contextText?: string;
}): Promise<{ url: string; cached: boolean; provider: 'unsplash' | 'placeholder'; fallbackUsed: boolean }> {
  void params.placeId;
  const dayKey = String(params.day ?? '').trim() || 'day';
  const cacheSuffix = sanitizeFilename(`${params.locationName}-${dayKey}`);
  const queryText = String(params.contextText ?? '').trim();

  try {
    const unsplashPath = `unsplash/${cacheSuffix}.jpg`;
    const accessKey = getUnsplashAccessKeyOrThrow();
    const unsplash = await fetchAndCache(unsplashPath, async () => {
      const destinationQuery = String(params.locationName ?? '').trim();
      const queries = queryText && queryText.toLowerCase() !== destinationQuery.toLowerCase()
        ? [queryText, destinationQuery]
        : [destinationQuery];
      for (const query of queries) {
        const imageUrl = await fetchUnsplashImageForItinerary(accessKey, query);
        if (imageUrl) return imageUrl;
      }
      logInfo(`[unsplash] no itinerary photo found for location="${destinationQuery || 'unknown'}"; using placeholder`);
      return '';
    });
    if (!unsplash.url) {
      return { url: '', cached: false, provider: 'placeholder', fallbackUsed: true };
    }
    return { url: unsplash.url, cached: unsplash.cached, provider: 'unsplash', fallbackUsed: false };
  } catch (error) {
    logError(`[unsplash] itinerary image request failed for location="${String(params.locationName ?? '').trim() || 'unknown'}"`, error);
    return { url: '', cached: false, provider: 'placeholder', fallbackUsed: true };
  }
}
