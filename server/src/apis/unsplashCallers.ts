import { getUnsplashRandomPhoto, searchUnsplashPhotos } from './unsplashApi';

const UNSPLASH_CALLER_IMAGE_SERVICE_LOCATION = 'IMAGE_SERVICE_LOCATION_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_ITINERARY = 'IMAGE_SERVICE_ITINERARY_IMAGE';
const UNSPLASH_CALLER_IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK = 'IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK';
const UNSPLASH_CALLER_HEALTH_CHECK = 'UNSPLASH_HEALTH_CHECK';

const firstRegularUrl = (data: Awaited<ReturnType<typeof searchUnsplashPhotos>>): string | null => {
  const url = data?.results?.[0]?.urls?.regular;
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
};

export const fetchUnsplashImageForLocation = async (
  accessKey: string,
  locationName: string
): Promise<string | null> => {
  const data = await searchUnsplashPhotos({
    caller: UNSPLASH_CALLER_IMAGE_SERVICE_LOCATION,
    accessKey,
    query: locationName,
    perPage: 1,
    orientation: 'landscape',
  });
  return firstRegularUrl(data);
};

export const fetchUnsplashImageForItinerary = async (
  accessKey: string,
  locationName: string
): Promise<string | null> => {
  const data = await searchUnsplashPhotos({
    caller: UNSPLASH_CALLER_IMAGE_SERVICE_ITINERARY,
    accessKey,
    query: locationName,
    perPage: 1,
    orientation: 'landscape',
  });
  return firstRegularUrl(data);
};

export const fetchUnsplashImageForGooglePlaceFallback = async (
  accessKey: string,
  locationName: string
): Promise<string | null> => {
  const data = await searchUnsplashPhotos({
    caller: UNSPLASH_CALLER_IMAGE_SERVICE_GOOGLE_PLACE_FALLBACK,
    accessKey,
    query: locationName,
    perPage: 1,
    orientation: 'landscape',
  });
  return firstRegularUrl(data);
};

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

