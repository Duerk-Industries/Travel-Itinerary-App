import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import { getEnvValue } from './env';
import { getApiCacheSetting } from './config/apiLimits';
import {
  fetchUnsplashImageForGooglePlaceFallback,
  fetchUnsplashImageForItinerary,
  fetchUnsplashImageForLocation,
} from './apis/unsplashCallers';

const storage = new Storage();
const bucketName = process.env.LOCATION_BUCKET || 'duerk-travel-itinerary-app-location-data';
const bucket = storage.bucket(bucketName);
const CACHE_TTL_MS =
  Number(getApiCacheSetting('images', 'cacheTtlMs')) ||
  Number(process.env.IMAGE_CACHE_TTL_MS) ||
  1000 * 60 * 60 * 24 * 7;
const SIGNED_URL_TTL_MS = Number(getApiCacheSetting('images', 'signedUrlTtlMs')) || 1000 * 60 * 60;

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
    throw new Error('Unsplash Access Key is not configured.');
  }
  return accessKey;
};

async function getCachedImageUrl(filepath: string): Promise<string | null> {
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
    console.error('Error checking cache:', error);
    return null;
  }
}

async function cacheImage(filepath: string, imageUrl: string): Promise<string> {
  try {
    const file = bucket.file(filepath);
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
    });

    await new Promise((resolve, reject) => {
      response.data
        .pipe(
          file.createWriteStream({
            metadata: {
              contentType: response.headers['content-type'],
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
    console.error('Error caching image:', error);
    return imageUrl;
  }
}

type CachedResult = { url: string; cached: boolean };

const fetchAndCache = async (cachePath: string, fetcher: () => Promise<string>): Promise<CachedResult> => {
  const cachedUrl = await getCachedImageUrl(cachePath);
  if (cachedUrl) return { url: cachedUrl, cached: true };
  const imageUrl = await fetcher();
  const cached = await cacheImage(cachePath, imageUrl);
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
    const unsplashQuery = queryText || params.locationName;
    const accessKey = getUnsplashAccessKeyOrThrow();
    const unsplash = await fetchAndCache(unsplashPath, async () => {
      const imageUrl = await fetchUnsplashImageForItinerary(accessKey, unsplashQuery);
      if (!imageUrl) {
        throw new Error('No photos found for itinerary image query.');
      }
      return imageUrl;
    });
    return { url: unsplash.url, cached: unsplash.cached, provider: 'unsplash', fallbackUsed: false };
  } catch {
    return { url: '', cached: false, provider: 'placeholder', fallbackUsed: true };
  }
}
