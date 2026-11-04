const mockExists = jest.fn(async () => [true]);
const mockSign = jest.fn(async () => ['https://signed.example/object']);
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: () => ({ file: () => ({ exists: mockExists, getSignedUrl: mockSign }) }),
  })),
}));

import { clearBlogReadUrlCacheForTesting, createBlogReadUrl } from '../src/services/blogStorageClient';

describe('createBlogReadUrl', () => {
  beforeEach(() => {
    clearBlogReadUrlCacheForTesting();
    mockExists.mockClear();
    mockSign.mockClear();
    mockExists.mockImplementation(async () => [true]);
  });
  afterEach(() => { jest.useRealTimers(); });

  it('checks that the object exists by default and returns null when it does not', async () => {
    mockExists.mockImplementation(async () => [false]);
    expect(await createBlogReadUrl('trip-blog/u/a/primary.jpg')).toBeNull();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('skips the existence check when asked to', async () => {
    expect(await createBlogReadUrl('trip-blog/u/a/primary.jpg', { verifyExists: false })).toBe('https://signed.example/object');
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it('reuses a signed URL for repeat requests', async () => {
    await createBlogReadUrl('trip-blog/u/a/thumb.jpg', { verifyExists: false });
    await createBlogReadUrl('trip-blog/u/a/thumb.jpg', { verifyExists: false });
    expect(mockSign).toHaveBeenCalledTimes(1);
    await createBlogReadUrl('trip-blog/u/b/thumb.jpg', { verifyExists: false });
    expect(mockSign).toHaveBeenCalledTimes(2);
  });

  it('signs again once the reuse window has passed, so a served URL always has most of its hour left', async () => {
    jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00Z') });
    await createBlogReadUrl('trip-blog/u/a/primary.jpg', { verifyExists: false });
    jest.setSystemTime(new Date('2027-01-01T00:19:00Z'));
    await createBlogReadUrl('trip-blog/u/a/primary.jpg', { verifyExists: false });
    expect(mockSign).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2027-01-01T00:21:00Z'));
    await createBlogReadUrl('trip-blog/u/a/primary.jpg', { verifyExists: false });
    expect(mockSign).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed signing attempt', async () => {
    mockSign.mockImplementationOnce(async () => { throw new Error('boom'); });
    expect(await createBlogReadUrl('trip-blog/u/a/x.jpg', { verifyExists: false })).toBeNull();
    expect(await createBlogReadUrl('trip-blog/u/a/x.jpg', { verifyExists: false })).toBe('https://signed.example/object');
  });
});
