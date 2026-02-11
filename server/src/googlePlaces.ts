import { getPlaceDetailsCache } from './db';

const readTimeoutMinutes = (rawValue: string | undefined, fallbackMinutes: number): number => {
  const raw = Number(rawValue);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return fallbackMinutes;
};

const PLACE_DETAILS_CACHE_TIMEOUT_MS =
  readTimeoutMinutes(process.env.GOOGLE_PLACES_DETAILS_CACHE_TIMEOUT_MINUTES, 24 * 60) * 60 * 1000;

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

type PlaceDetailsResponse = {
  placeId: string;
  name: string;
  details: Record<string, any>;
  cached: boolean;
};

export const getPlacePhotoUrlByPlaceId = async (placeId: string): Promise<string | null> => {
  void placeId;
  return null;
};

export const findPlacePhoto = async (query: string): Promise<string | null> => {
  void query;
  return null;
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
  void query;
  void options;
  return [];
};

export const getPlaceDetails = async (
  placeId: string,
  fieldMask: string[] = DEFAULT_PLACE_DETAILS_FIELDS
): Promise<PlaceDetailsResponse | null> => {
  void fieldMask;
  const trimmedId = placeId?.trim();
  if (!trimmedId) return null;

  try {
    const cached = await getPlaceDetailsCache(trimmedId);
    if (!cached?.fetchedAt) return null;
    const fetchedAtMs = new Date(cached.fetchedAt).getTime();
    if (!Number.isFinite(fetchedAtMs)) return null;
    if (Date.now() - fetchedAtMs >= PLACE_DETAILS_CACHE_TIMEOUT_MS) return null;
    return { placeId: trimmedId, name: cached.name, details: cached.details, cached: true };
  } catch {
    return null;
  }
};
