import axios from 'axios';
import { getEnvValue } from '../env';

const GOOGLE_PLACES_API_URL = 'https://maps.googleapis.com/maps/api/place';

export const autocompletePlaces = async (input: string): Promise<any[]> => {
  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    console.warn('Google Places API key not configured');
    return [];
  }

  try {
    const response = await axios.get(`${GOOGLE_PLACES_API_URL}/autocomplete/json`, {
      params: {
        input,
        key: apiKey,
        types: '(regions)',
      },
    });

    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      console.error(`Google Places API error (autocomplete): ${response.data.status}`, response.data.error_message);
      return [];
    }

    return response.data.predictions || [];
  } catch (error) {
    console.error('Error calling Google Places Autocomplete', error);
    return [];
  }
};

export const getPlaceDetailsFromGoogle = async (placeId: string): Promise<any | null> => {
  const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    console.warn('Google Places API key not configured');
    return null;
  }

  try {
    const response = await axios.get(`${GOOGLE_PLACES_API_URL}/details/json`, {
      params: {
        place_id: placeId,
        key: apiKey,
        fields: 'place_id,name,formatted_address,geometry,photos,types,url,vicinity',
      },
    });

    if (response.data.status !== 'OK') {
      console.error(`Google Places API error (details): ${response.data.status}`, response.data.error_message);
      return null;
    }

    return response.data.result;
  } catch (error) {
    console.error('Error calling Google Places Details', error);
    return null;
  }
};
