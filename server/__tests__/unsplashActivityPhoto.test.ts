/// <reference types="jest" />
/// <reference types="node" />
jest.mock('../src/apis/unsplashApi', () => ({
  searchUnsplashPhotos: jest.fn(),
  getUnsplashRandomPhoto: jest.fn(),
}));

import { searchUnsplashPhotos } from '../src/apis/unsplashApi';
import { ApiLimitExceededError } from '../src/apis/usageLimiter';
import { clearUnsplashUrlCache, fetchUnsplashPhotoForActivity } from '../src/apis/unsplashCallers';

const search = searchUnsplashPhotos as jest.MockedFunction<typeof searchUnsplashPhotos>;
const result = (url: string, extra: Record<string, unknown> = {}) => ({ urls: { regular: url }, user: { name: 'Ada Lovelace' }, links: { html: `${url}/page` }, ...extra });

describe('fetchUnsplashPhotoForActivity', () => {
  beforeEach(() => {
    clearUnsplashUrlCache();
    search.mockReset();
  });

  it('takes the first photo that mentions the activity, with the photographer credit and page', async () => {
    search.mockResolvedValue({ results: [
      result('https://u/a', { alt_description: 'a random beach' }),
      result('https://u/b', { alt_description: 'view of the Eiffel Tower at dusk' }),
    ] });
    await expect(fetchUnsplashPhotoForActivity('key', 'Eiffel Tower visit', 'Paris')).resolves.toEqual({
      url: 'https://u/b', credit: 'Ada Lovelace, Unsplash', pageUrl: 'https://u/b/page',
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'Eiffel Tower visit Paris', perPage: 10 }));
  });

  it('finds nothing rather than an unrelated picture', async () => {
    search.mockResolvedValue({ results: [result('https://u/a', { alt_description: 'a random beach' })] });
    await expect(fetchUnsplashPhotoForActivity('key', 'Louvre tour')).resolves.toBeNull();
    await expect(fetchUnsplashPhotoForActivity('key', '  ')).resolves.toBeNull();
  });

  it('reports a provider limit as undefined, and pauses briefly instead of searching again', async () => {
    search.mockRejectedValue(new ApiLimitExceededError({ provider: 'UNSPLASH', caller: 'ACTIVITY_PHOTO', scope: 'caller' as any, limit: 30, used: 30 }));
    await expect(fetchUnsplashPhotoForActivity('key', 'Louvre tour')).resolves.toBeUndefined();
    await expect(fetchUnsplashPhotoForActivity('key', 'Colosseum tour')).resolves.toBeUndefined();
    expect(search).toHaveBeenCalledTimes(1);
  });
});
