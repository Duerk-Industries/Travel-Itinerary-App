import axios from 'axios';
import { findPlacePhoto } from '../src/googlePlaces';
import * as env from '../src/env';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
});
