import axios from 'axios';
import { getEnvValue } from './env';
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
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    types?: string[];
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
      return photoUrl;
    }
    return null;
  } catch (error) {
    return null;
  }
};

export type PlaceCandidate = {
  placeId: string;
  name: string;
  formattedAddress?: string;
  types?: string[];
};

export const searchPlaceCandidates = async (
  query: string,
  options?: { locationBias?: { latitude: number; longitude: number; radiusMeters: number } }
): Promise<PlaceCandidate[]> => {
  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    return [];
  }

  try {
    const payload: Record<string, any> = {
      textQuery: query,
      languageCode: 'en',
    };
    if (options?.locationBias) {
      payload.locationBias = {
        circle: {
          center: {
            latitude: options.locationBias.latitude,
            longitude: options.locationBias.longitude,
          },
          radius: options.locationBias.radiusMeters,
        },
      };
    }

    const response = await axios.post(
      PLACES_API_URL,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.types',
        },
      }
    );

    const data = response.data as PlaceResult;
    const places = data?.places ?? [];
    return places
      .map((place) => {
        const name = place.displayName?.text ?? '';
        const id = place.id ?? '';
        if (!id || !name) return null;
        return {
          placeId: id,
          name,
          formattedAddress: place.formattedAddress,
          types: place.types ?? [],
        } as PlaceCandidate;
      })
      .filter(Boolean) as PlaceCandidate[];
  } catch {
    return [];
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
        return { placeId: trimmedId, name: cached.name, details: cached.details, cached: true };
      }
    }
  } catch {
    // ignore cache errors
  }

  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
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
    return { placeId: trimmedId, name, details, cached: false };
  } catch {
    try {
      const cached = await getPlaceDetailsCache(trimmedId);
      if (cached) {
        return { placeId: trimmedId, name: cached.name, details: cached.details, cached: true };
      }
    } catch {
      // ignore cache errors
    }
    return null;
  }
};
