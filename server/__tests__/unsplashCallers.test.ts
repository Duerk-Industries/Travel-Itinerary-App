/// <reference types="jest" />
/// <reference types="node" />
jest.mock('../src/apis/unsplashApi', () => ({
  searchUnsplashPhotos: jest.fn(),
  getUnsplashRandomPhoto: jest.fn(),
}));

jest.mock('../src/config/apiLimits', () => ({
  ...jest.requireActual('../src/config/apiLimits'),
  getApiCacheSetting: jest.fn(),
}));

import { searchUnsplashPhotos } from '../src/apis/unsplashApi';
import { getApiCacheSetting } from '../src/config/apiLimits';
import { ApiLimitExceededError } from '../src/apis/usageLimiter';
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

  it('adds the bounded itinerary variant to the Unsplash query', async () => {
    mockedSearch.mockResolvedValueOnce({
      results: [{ urls: { regular: 'https://images.example/tokyo-food.jpg' }, alt_description: 'ramen stall in Tokyo' }],
    });

    await expect(fetchUnsplashImageForItinerary('key', 'Tokyo', 'food')).resolves.toBe(
      'https://images.example/tokyo-food.jpg'
    );
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Tokyo local food', perPage: 10 })
    );
  });

  // Regression: "Lisbon culture landmarks" returned the Louvre as its top hit.
  it('skips themed results that name another city and keeps the first one naming the destination', async () => {
    mockedSearch.mockResolvedValueOnce({
      results: [
        { urls: { regular: 'https://images.example/louvre.jpg' }, alt_description: 'Louvre pyramid at dusk', location: { city: 'Paris', country: 'France' } },
        { urls: { regular: 'https://images.example/porto.jpg' }, description: 'Ribeira at night', location: { city: 'Porto', country: 'Portugal' } },
        { urls: { regular: 'https://images.example/belem.jpg' }, alt_description: 'Belém Tower', tags: [{ title: 'lisbon' }] },
      ],
    });

    await expect(fetchUnsplashImageForItinerary('key', 'Lisbon, Portugal', 'culture')).resolves.toBe(
      'https://images.example/belem.jpg'
    );
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it('matches the destination ignoring accents and case', async () => {
    mockedSearch.mockResolvedValueOnce({
      results: [{ urls: { regular: 'https://images.example/sao-paulo.jpg' }, location: { city: 'São Paulo' } }],
    });

    await expect(fetchUnsplashImageForItinerary('key', 'sao paulo', 'outdoors')).resolves.toBe(
      'https://images.example/sao-paulo.jpg'
    );
  });

  it('falls back to a plain destination search when no themed result names the destination', async () => {
    mockedSearch
      .mockResolvedValueOnce({
        results: [{ urls: { regular: 'https://images.example/louvre.jpg' }, location: { city: 'Paris' } }],
      })
      .mockResolvedValueOnce({
        results: [{ urls: { regular: 'https://images.example/lisboa.jpg' }, alt_description: 'tram on a hill in Lisboa' }],
      });

    await expect(fetchUnsplashImageForItinerary('key', 'Lisbon', 'culture')).resolves.toBe(
      'https://images.example/lisboa.jpg'
    );
    expect(mockedSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: 'Lisbon culture landmarks' }));
    expect(mockedSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: 'Lisbon' }));
  });

  it('gives each day theme a different photo when they all fall back to the plain destination search', async () => {
    const plain = {
      results: ['a', 'b', 'c'].map((id) => ({ urls: { regular: `https://images.example/lisbon-${id}.jpg` }, description: `Lisbon ${id}` })),
    };
    mockedSearch.mockImplementation(async ({ query }: any) => (query === 'Lisbon' ? plain : { results: [] }) as any);

    const picks = await Promise.all(
      (['culture', 'food', 'outdoors'] as const).map((variant) => fetchUnsplashImageForItinerary('key', 'Lisbon', variant))
    );

    expect(new Set(picks).size).toBe(3);
  });

  it('returns null without caching for empty queries', async () => {
    const result = await fetchUnsplashImageForLocation('key', '   ');
    expect(result).toBeNull();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('pauses repeated itinerary searches after the provider limit is reached', async () => {
    mockedSearch.mockRejectedValueOnce(new ApiLimitExceededError({
      provider: 'UNSPLASH',
      caller: 'IMAGE_SERVICE_ITINERARY_IMAGE',
      scope: 'overall',
      limit: 50,
      used: 50,
    }));

    await expect(fetchUnsplashImageForItinerary('key', 'Osaka')).resolves.toBeNull();
    await expect(fetchUnsplashImageForItinerary('key', 'Tokyo')).resolves.toBeNull();
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });
});
