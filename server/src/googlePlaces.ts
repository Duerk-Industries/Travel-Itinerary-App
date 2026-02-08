import axios from 'axios';
import { getEnvValue } from './env';
import { logError, logInfo } from './logger';
import { getPlaceDetailsCache, upsertPlaceDetailsCache } from './db';

const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const readTimeoutMinutes = (key: string, fallbackMinutes: number): number => {
  const raw = Number(getEnvValue(key));
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return fallbackMinutes;
};
const PLACE_DETAILS_CACHE_TIMEOUT_MS =
  readTimeoutMinutes('GOOGLE_PLACES_DETAILS_CACHE_TIMEOUT_MINUTES', 24 * 60) * 60 * 1000;
const DEFAULT_PLACE_DETAILS_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'websiteUri',
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'regularOpeningHours',
  'photos',
  'rating',
  'userRatingCount',
];

type PlaceResult = {
  places: {
    photos: {
      name: string;
      widthPx: number;
      heightPx: number;
      authorAttributions: {
        displayName: string;
        uri: string;
        photoUri: string;
      }[];
    }[];
  }[];
};

type PlaceDetailsResponse = {
  placeId: string;
  name: string;
  details: Record<string, any>;
  cached: boolean;
};

const getPhotoUrl = (photoName: string, apiKey: string): string => {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1200&key=${apiKey}`;
};

export const getPlacePhotoUrlByPlaceId = async (placeId: string): Promise<string | null> => {
  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return null;
  const details = await getPlaceDetails(placeId, ['id', 'photos']);
  const photoName = details?.details?.photos?.[0]?.name;
  if (!photoName || typeof photoName !== 'string') return null;
  return getPhotoUrl(photoName, apiKey);
};

const getDisplayName = (details: any, fallback: string): string => {
  if (!details) return fallback;
  if (typeof details.displayName === 'string') return details.displayName;
  if (details.displayName?.text) return details.displayName.text;
  if (typeof details.name === 'string') return details.name;
  return fallback;
};

const normalizeFields = (fields?: string[]): string[] => {
  const normalized = new Set((fields ?? []).map((field) => field.trim()).filter(Boolean));
  for (const required of ['id', 'displayName']) {
    normalized.add(required);
  }
  return normalized.size ? Array.from(normalized) : DEFAULT_PLACE_DETAILS_FIELDS;
};

export const findPlacePhoto = async (query: string): Promise<string | null> => {
  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    logError('[googlePlaces] GOOGLE_PLACES_API_KEY is not set.');
    return null;
  }

  try {
    const response = await axios.post(
      PLACES_API_URL,
      {
        textQuery: query,
        languageCode: 'en',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.photos',
        },
      }
    );

    const data = response.data as PlaceResult;
    const photo = data?.places?.[0]?.photos?.[0];

    if (photo?.name) {
      const photoUrl = getPhotoUrl(photo.name, apiKey);
      logInfo(`[googlePlaces] Found photo for query: ${query}`);
      return photoUrl;
    } else {
      logInfo(`[googlePlaces] No photo found for query: ${query}`);
      return null;
    }
  } catch (error) {
    logError(`[googlePlaces] Error finding place photo for query: ${query}`, error);
    return null;
  }
};

export const getPlaceDetails = async (
  placeId: string,
  fieldMask: string[] = DEFAULT_PLACE_DETAILS_FIELDS
): Promise<PlaceDetailsResponse | null> => {
  const trimmedId = placeId?.trim();
  if (!trimmedId) return null;

  try {
    const cached = await getPlaceDetailsCache(trimmedId);
    if (cached?.fetchedAt) {
      const fetchedAtMs = new Date(cached.fetchedAt).getTime();
      if (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < PLACE_DETAILS_CACHE_TIMEOUT_MS) {
        logInfo(`[googlePlaces] Using cached Place Details for placeId: ${trimmedId}`);
        return { placeId: trimmedId, name: cached.name, details: cached.details, cached: true };
      }
    }
  } catch (error) {
    logError(`[googlePlaces] Error reading cached Place Details for placeId: ${trimmedId}`, error);
  }

  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    logError('[googlePlaces] GOOGLE_PLACES_API_KEY is not set.');
    return null;
  }

  try {
    const normalizedFields = normalizeFields(fieldMask);
    const response = await axios.get(`${PLACE_DETAILS_URL}/${encodeURIComponent(trimmedId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': normalizedFields.join(','),
      },
    });
    const details = response.data as Record<string, any>;
    const name = getDisplayName(details, trimmedId);
    await upsertPlaceDetailsCache({ placeId: trimmedId, name, details, fetchedAt: new Date() });
    logInfo(`[googlePlaces] Retrieved Place Details for placeId: ${trimmedId}`);
    return { placeId: trimmedId, name, details, cached: false };
  } catch (error) {
    logError(`[googlePlaces] Error fetching Place Details for placeId: ${trimmedId}`, error);
    try {
      const cached = await getPlaceDetailsCache(trimmedId);
      if (cached) {
        return { placeId: trimmedId, name: cached.name, details: cached.details, cached: true };
      }
    } catch (cacheError) {
      logError(`[googlePlaces] Error reading fallback Place Details cache for placeId: ${trimmedId}`, cacheError);
    }
    return null;
  }
};
