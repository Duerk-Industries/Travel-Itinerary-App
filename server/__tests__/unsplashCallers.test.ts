/// <reference types="jest" />
/// <reference types="node" />
jest.mock('../src/apis/unsplashApi', () => ({
  searchUnsplashPhotos: jest.fn(),
  getUnsplashRandomPhoto: jest.fn(),
}));

jest.mock('../src/config/apiLimits', () => ({
  getApiCacheSetting: jest.fn(),
}));

import { searchUnsplashPhotos } from '../src/apis/unsplashApi';
import { getApiCacheSetting } from '../src/config/apiLimits';
import {
  clearUnsplashUrlCache,
  fetchUnsplashImageForItinerary,
  fetchUnsplashImageForLocation,
} from '../src/apis/unsplashCallers';

const mockedSearch = searchUnsplashPhotos as jest.MockedFunction<typeof searchUnsplashPhotos>;
const mockedGetApiCacheSetting = getApiCacheSetting as jest.MockedFunction<typeof getApiCacheSetting>;

const photoResponse = (url: string | null) => ({
  results: url ? [{ urls: { regular: url } }] : [],
});

describe('unsplashCallers (dedupe + TTL cache)', () => {
  beforeEach(() => {
    clearUnsplashUrlCache();
    mockedSearch.mockReset();
    mockedGetApiCacheSetting.mockReset();
    mockedGetApiCacheSetting.mockReturnValue(60_000);
  });

  it('deduplicates concurrent requests for the same location', async () => {
    let resolveSearch: ((value: unknown) => void) | null = null;
    mockedSearch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );

    const [first, second] = [
      fetchUnsplashImageForLocation('key', 'Paris'),
      fetchUnsplashImageForLocation('key', 'paris'),
    ];

    expect(mockedSearch).toHaveBeenCalledTimes(1);

    resolveSearch?.(photoResponse('https://images.example/paris.jpg'));

    await expect(first).resolves.toBe('https://images.example/paris.jpg');
    await expect(second).resolves.toBe('https://images.example/paris.jpg');
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it('serves subsequent sequential calls from the TTL cache without re-hitting the API', async () => {
    mockedSearch.mockResolvedValueOnce(photoResponse('https://images.example/tokyo.jpg'));

    const first = await fetchUnsplashImageForLocation('key', 'Tokyo');
    const second = await fetchUnsplashImageForLocation('key', '  TOKYO ');

    expect(first).toBe('https://images.example/tokyo.jpg');
    expect(second).toBe('https://images.example/tokyo.jpg');
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it('expires entries past the configured TTL and re-fetches', async () => {
    mockedGetApiCacheSetting.mockReturnValue(100);
    mockedSearch
      .mockResolvedValueOnce(photoResponse('https://images.example/rome-1.jpg'))
      .mockResolvedValueOnce(photoResponse('https://images.example/rome-2.jpg'));

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    const first = await fetchUnsplashImageForLocation('key', 'Rome');
    expect(first).toBe('https://images.example/rome-1.jpg');

    nowSpy.mockReturnValue(1_000_500);
    const second = await fetchUnsplashImageForLocation('key', 'Rome');
    expect(second).toBe('https://images.example/rome-2.jpg');
    expect(mockedSearch).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('does not share cache entries across different callers', async () => {
    mockedSearch
      .mockResolvedValueOnce(photoResponse('https://images.example/location.jpg'))
      .mockResolvedValueOnce(photoResponse('https://images.example/itinerary.jpg'));

    const location = await fetchUnsplashImageForLocation('key', 'Kyoto');
    const itinerary = await fetchUnsplashImageForItinerary('key', 'Kyoto');

    expect(location).toBe('https://images.example/location.jpg');
    expect(itinerary).toBe('https://images.example/itinerary.jpg');
    expect(mockedSearch).toHaveBeenCalledTimes(2);
  });

  it('returns null without caching for empty queries', async () => {
    const result = await fetchUnsplashImageForLocation('key', '   ');
    expect(result).toBeNull();
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
