import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import { getEnvValue } from './env';
import { getPlaceLookupCache, upsertPlaceLookupCache } from './db';
import { getPlaceDetails, searchPlaceCandidates } from './googlePlaces';

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

const getPlaceMatchThreshold = (): number => {
    const raw = Number(getEnvValue('PLACE_MATCH_THRESHOLD', { defaultValue: '0.75' }));
    if (!Number.isFinite(raw)) return 0.75;
    return Math.max(0, Math.min(1, raw));
};

const lookupCacheTtlMs = (): number => {
    const minutes = Number(getEnvValue('GOOGLE_PLACES_DETAILS_CACHE_TIMEOUT_MINUTES', { defaultValue: '1440' }));
    if (!Number.isFinite(minutes) || minutes <= 0) return 24 * 60 * 60 * 1000;
    return minutes * 60 * 1000;
};

const getGooglePhotoUrl = (photoName: string, apiKey: string): string =>
    `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1200&key=${apiKey}`;

const MAX_GOOGLE_PHOTOS = 10;
const DEFAULT_BIAS_RADIUS_METERS = 150000;

const getGooglePhotoNames = async (placeId: string, maxPhotos = MAX_GOOGLE_PHOTOS): Promise<string[]> => {
    const details = await getPlaceDetails(placeId, ['id', 'photos', 'displayName']);
    const photos = details?.details?.photos ?? [];
    const names = photos
        .map((photo: any) => (photo?.name ? String(photo.name) : ''))
        .filter(Boolean)
        .slice(0, maxPhotos);
    if (!names.length) {
        throw new Error('No photos found for the location in Google Place Details.');
    }
    return names;
};

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const getLocationBiasRadius = (types: string[] = []): number => {
    if (types.includes('country')) return 500000;
    if (types.includes('administrative_area_level_1')) return 300000;
    if (types.includes('locality')) return 75000;
    return DEFAULT_BIAS_RADIUS_METERS;
};

const resolveLocationBias = async (locationName: string, threshold: number): Promise<{ latitude: number; longitude: number; radiusMeters: number } | null> => {
    const normalized = normalizeQueryKey(locationName);
    if (!normalized) return null;
    const queryKey = `location:${normalized}`;
    let placeId: string | undefined;

    const cached = await getPlaceLookupCache(queryKey).catch(() => null);
    if (cached?.fetchedAt) {
        const fetchedAtMs = new Date(cached.fetchedAt).getTime();
        if (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < lookupCacheTtlMs()) {
            placeId = cached.placeId;
        }
    }

    if (!placeId) {
        const candidates = await searchPlaceCandidates(locationName);
        if (candidates.length) {
            let best = candidates[0];
            let bestScore = computePlaceMatchLikelihood(locationName, best.name);
            for (const candidate of candidates.slice(1)) {
                const score = computePlaceMatchLikelihood(locationName, candidate.name);
                if (score > bestScore) {
                    best = candidate;
                    bestScore = score;
                }
            }
            // no logging
            if (bestScore >= threshold) {
                placeId = best.placeId;
                await upsertPlaceLookupCache({
                    queryKey,
                    placeId: best.placeId,
                    name: best.name,
                    likelihood: bestScore,
                    fetchedAt: new Date(),
                }).catch(() => undefined);
            }
        }
    }

    if (!placeId) return null;
    const details = await getPlaceDetails(placeId, ['id', 'location', 'types']).catch(() => null);
    const location = details?.details?.location;
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const radiusMeters = getLocationBiasRadius(details?.details?.types ?? []);
    return { latitude, longitude, radiusMeters };
};

const getRandomGooglePlaceImage = async (
    placeId: string,
    cachePrefix: string
): Promise<{ url: string; cached: boolean }> => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        throw new Error('Google Places API key is not configured.');
    }
    const photoNames = await getGooglePhotoNames(placeId);
    const candidates: Array<{ url: string; cached: boolean }> = [];

    for (let i = 0; i < photoNames.length; i += 1) {
        const cachePath = `${cachePrefix}/photo-${i + 1}.jpg`;
        const cachedUrl = await getCachedImageUrl(cachePath);
        if (cachedUrl) {
            candidates.push({ url: cachedUrl, cached: true });
            continue;
        }
        const photoUrl = getGooglePhotoUrl(photoNames[i], apiKey);
        const cached = await cacheImage(cachePath, photoUrl);
        candidates.push({ url: cached, cached: false });
    }

    return pickRandom(candidates);
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
            responseType: 'stream'
        });

        await new Promise((resolve, reject) => {
            response.data.pipe(file.createWriteStream({
                metadata: {
                    contentType: response.headers['content-type']
                }
            }))
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

const fetchGooglePlaceImageNoCache = async (
    locationName: string,
    placeId?: string,
    cachePrefix?: string
): Promise<string> => {
    let finalPlaceId = placeId;

    if (!finalPlaceId) {
        const candidates = await searchPlaceCandidates(locationName);
        if (!candidates.length) {
            throw new Error('No results found in Google Places Text Search.');
        }
        finalPlaceId = candidates[0].placeId;
    }

    const prefix = cachePrefix || `google-places/${sanitizeFilename(finalPlaceId)}`;
    const selected = await getRandomGooglePlaceImage(finalPlaceId, prefix);
    return selected.url;
};

const fetchUnsplashImageNoCache = async (locationName: string): Promise<string> => {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        throw new Error('Unsplash Access Key is not configured.');
    }

    const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(locationName)}&per_page=1&orientation=landscape`;
    const unsplashResponse = await axios.get(unsplashUrl, {
        headers: {
            'Authorization': `Client-ID ${accessKey}`
        }
    });

    if (!unsplashResponse.data.results || unsplashResponse.data.results.length === 0) {
        throw new Error('No photos found for the location on Unsplash.');
    }

    return unsplashResponse.data.results[0].urls.regular;
};

/**
 * Fetches an image URL from the Google Places API for a given location.
 * @param {string} locationName The name of the location (e.g., "Paris").
 * @param {string} [placeId] Optional Google Place ID. If provided, skips text search and uses this ID.
 * @returns {Promise<string>} A promise that resolves to an image URL.
 * @throws {Error} If no image can be found.
 */
export async function getGooglePlaceImage(locationName: string, placeId?: string): Promise<string> {
    // Use placeId for cache key if available for stability, otherwise fallback to locationName
    const filename = sanitizeFilename(placeId || locationName);
    const cachePrefix = `google-places/${filename}`;
    return fetchGooglePlaceImageNoCache(locationName, placeId, cachePrefix);
}

/**
 * Fetches an image URL from the Unsplash API for a given location.
 * @param {string} locationName The name of the location to search for.
 * @returns {Promise<string>} A promise that resolves to an image URL.
 * @throws {Error} If no image can be found.
 */
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
}): Promise<{ url: string; cached: boolean; provider: 'unsplash' | 'google' | 'placeholder'; fallbackUsed: boolean }> {
    const dayKey = String(params.day ?? '').trim() || 'day';
    const cacheSuffix = sanitizeFilename(`${params.locationName}-${dayKey}`);
    const queryText = String(params.contextText ?? '').trim();
    const threshold = getPlaceMatchThreshold();

    let matchedPlaceId: string | undefined;
    let matchedLikelihood: number | undefined;

    const locationBias = params.locationName ? await resolveLocationBias(params.locationName, threshold).catch(() => null) : null;

    if (queryText) {
        const queryKey = normalizeQueryKey(queryText);
        const cached = await getPlaceLookupCache(queryKey).catch(() => null);
        if (cached?.fetchedAt) {
            const fetchedAtMs = new Date(cached.fetchedAt).getTime();
            if (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < lookupCacheTtlMs()) {
                matchedPlaceId = cached.placeId;
                // cached name available if needed later
                matchedLikelihood = Number(cached.likelihood ?? 0);
                // no logging
            }
        }

        if (!matchedPlaceId || (matchedLikelihood ?? 0) < threshold) {
            if (matchedPlaceId) {
                // no logging
            } else {
                const candidates = await searchPlaceCandidates(queryText, locationBias ? { locationBias } : undefined);
            if (candidates.length) {
                let best = candidates[0];
                let bestScore = computePlaceMatchLikelihood(queryText, best.name);
                for (const candidate of candidates.slice(1)) {
                    const score = computePlaceMatchLikelihood(queryText, candidate.name);
                    if (score > bestScore) {
                        best = candidate;
                        bestScore = score;
                    }
                }
                matchedLikelihood = bestScore;
                // no logging
                if (bestScore >= threshold) {
                    matchedPlaceId = best.placeId;
                    await upsertPlaceLookupCache({
                        queryKey,
                        placeId: best.placeId,
                        name: best.name,
                        likelihood: bestScore,
                        fetchedAt: new Date(),
                    }).catch(() => undefined);
                    await getPlaceDetails(best.placeId).catch(() => undefined);
                }
            } else {
                // no logging
            }
            }
        }
    }

    const googlePlaceId = matchedPlaceId || params.placeId;
    if (googlePlaceId) {
        const googleKey = sanitizeFilename(`${googlePlaceId}-${dayKey}`);
        const googlePrefix = `google-places/${googleKey}`;
        try {
            const google = await getRandomGooglePlaceImage(googlePlaceId, googlePrefix);
            return { url: google.url, cached: google.cached, provider: 'google', fallbackUsed: Boolean(matchedPlaceId) };
        } catch (error) {
            // fallback to unsplash below
        }
    }

    try {
        const unsplashPath = `unsplash/${cacheSuffix}.jpg`;
        const unsplashQuery = queryText || params.locationName;
        const unsplash = await fetchAndCache(unsplashPath, () => fetchUnsplashImageNoCache(unsplashQuery));
        return { url: unsplash.url, cached: unsplash.cached, provider: 'unsplash', fallbackUsed: Boolean(matchedPlaceId) };
    } catch (err) {
        return { url: '', cached: false, provider: 'placeholder', fallbackUsed: true };
    }
}
