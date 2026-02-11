import { findPlacePhoto, getPlaceDetails } from '../src/googlePlaces';
import * as db from '../src/db';

jest.mock('../src/db', () => ({
  getPlaceDetailsCache: jest.fn(),
}));

const mockedDb = db as jest.Mocked<typeof db>;

describe('googlePlaces (disabled/network-free mode)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('findPlacePhoto returns null', async () => {
    const imageUrl = await findPlacePhoto('some query');
    expect(imageUrl).toBeNull();
  });

  it('returns cached place details when cache is fresh', async () => {
    const now = new Date('2026-02-01T12:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockedDb.getPlaceDetailsCache.mockResolvedValue({
      placeId: 'place-123',
      name: 'Cached Place',
      details: { websiteUri: 'https://example.com' },
      fetchedAt: new Date(now - 1000 * 60 * 60).toISOString(),
    } as any);

    const result = await getPlaceDetails('place-123');
    expect(result).toEqual({
      placeId: 'place-123',
      name: 'Cached Place',
      details: { websiteUri: 'https://example.com' },
      cached: true,
    });
    nowSpy.mockRestore();
  });

  it('returns null when cache is stale', async () => {
    const now = new Date('2026-02-01T12:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockedDb.getPlaceDetailsCache.mockResolvedValue({
      placeId: 'place-456',
      name: 'Old Place',
      details: { websiteUri: 'https://old.example.com' },
      fetchedAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
    } as any);

    const result = await getPlaceDetails('place-456');
    expect(result).toBeNull();
    nowSpy.mockRestore();
  });

  it('returns null for empty place ids', async () => {
    const result = await getPlaceDetails('   ');
    expect(result).toBeNull();
  });
});
