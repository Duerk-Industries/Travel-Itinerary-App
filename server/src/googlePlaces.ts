import axios from 'axios';
import { getEnvValue } from './env';
import { logError, logInfo } from './logger';

const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText';

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

const getPhotoUrl = (photoName: string, apiKey: string): string => {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1200&key=${apiKey}`;
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
