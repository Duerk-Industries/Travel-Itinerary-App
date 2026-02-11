import axios from 'axios';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucketName = process.env.LOCATION_BUCKET || 'duerk-travel-itinerary-app-location-data';
const bucket = storage.bucket(bucketName);
const CACHE_TTL_MS = Number(process.env.IMAGE_CACHE_TTL_MS) || 1000 * 60 * 60 * 24 * 7; // 7 days default

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
      expires: Date.now() + 1000 * 60 * 60, // 1 hour
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
      expires: Date.now() + 1000 * 60 * 60, // 1 hour
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
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    throw new Error('Unsplash Access Key is not configured.');
  }

  const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(locationName)}&per_page=1&orientation=landscape`;
  const unsplashResponse = await axios.get(unsplashUrl, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
    },
  });

  if (!unsplashResponse.data.results || unsplashResponse.data.results.length === 0) {
    throw new Error('No photos found for the location on Unsplash.');
  }

  return unsplashResponse.data.results[0].urls.regular;
};

// Kept for compatibility: Google Places is disabled, so this now falls back to Unsplash.
export async function getGooglePlaceImage(locationName: string, placeId?: string): Promise<string> {
  void placeId;
  const fallbackQuery = String(locationName ?? '').trim() || 'travel destination';
  return fetchUnsplashImageNoCache(fallbackQuery);
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
    const unsplash = await fetchAndCache(unsplashPath, () => fetchUnsplashImageNoCache(unsplashQuery));
    return { url: unsplash.url, cached: unsplash.cached, provider: 'unsplash', fallbackUsed: false };
  } catch {
    return { url: '', cached: false, provider: 'placeholder', fallbackUsed: true };
  }
}
