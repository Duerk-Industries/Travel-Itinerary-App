import axios from 'axios';
import { findPlacePhoto, getPlaceDetails } from '../src/googlePlaces';
import * as env from '../src/env';
import * as db from '../src/db';

jest.mock('axios');
jest.mock('../src/db', () => ({
  getPlaceDetailsCache: jest.fn(),
  upsertPlaceDetailsCache: jest.fn(),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDb = db as jest.Mocked<typeof db>;

jest.spyOn(env, 'getEnvValue').mockReturnValue('test');

describe('googlePlaces', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a photo URL when the API finds a place with a photo', async () => {
    const mockResponse = {
      data: {
        places: [
          {
            photos: [
              {
                name: 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AUacShh3_f-3f-3f-3f-3f-3f-3f-3f-3',
              },
            ],
          },
        ],
      },
    };
    mockedAxios.post.mockResolvedValue(mockResponse);

    const imageUrl = await findPlacePhoto('some query');
    expect(imageUrl).not.toBeNull();
    expect(typeof imageUrl).toBe('string');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should return null when the API does not find a place', async () => {
    const mockResponse = {
      data: {
        places: [],
      },
    };
    mockedAxios.post.mockResolvedValue(mockResponse);

    const imageUrl = await findPlacePhoto('some query');
    expect(imageUrl).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should return null when the place has no photo', async () => {
    const mockResponse = {
      data: {
        places: [
          {
            photos: [],
          },
        ],
      },
    };
    mockedAxios.post.mockResolvedValue(mockResponse);

    const imageUrl = await findPlacePhoto('some query');
    expect(imageUrl).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should return null when the API call fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('API Error'));

    const imageUrl = await findPlacePhoto('some query');
    expect(imageUrl).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('returns cached place details when cache is fresh', async () => {
    const now = new Date('2026-02-01T12:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockedDb.getPlaceDetailsCache.mockResolvedValue({
      placeId: 'place-123',
      name: 'Cached Place',
      details: { websiteUri: 'https://example.com' },
      fetchedAt: new Date(now - 1000 * 60 * 60).toISOString(),
    });

    const result = await getPlaceDetails('place-123');
    expect(result).toEqual({
      placeId: 'place-123',
      name: 'Cached Place',
      details: { websiteUri: 'https://example.com' },
      cached: true,
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('refreshes place details when cache is stale', async () => {
    const now = new Date('2026-02-01T12:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockedDb.getPlaceDetailsCache.mockResolvedValue({
      placeId: 'place-456',
      name: 'Old Place',
      details: { websiteUri: 'https://old.example.com' },
      fetchedAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
    });
    mockedAxios.get.mockResolvedValue({
      data: { id: 'place-456', displayName: { text: 'New Place' }, rating: 4.7 },
    });

    const result = await getPlaceDetails('place-456');
    expect(result?.cached).toBe(false);
    expect(result?.placeId).toBe('place-456');
    expect(result?.details).toEqual({ id: 'place-456', displayName: { text: 'New Place' }, rating: 4.7 });
    expect(mockedDb.upsertPlaceDetailsCache).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});
