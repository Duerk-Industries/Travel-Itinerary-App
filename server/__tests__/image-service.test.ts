/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import {
  clearImageServiceCachesForTests,
  getGooglePlaceImage,
  getUnsplashImage,
} from '../src/image-service';

let mockBucket: jest.Mock;

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: mockBucket })),
}));
jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn(),
}));

describe('image-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearImageServiceCachesForTests();
    mockBucket = jest.fn();
    process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash-key';
  });

  it('getGooglePlaceImage falls back to Unsplash', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        results: [{ urls: { regular: 'https://images.example.com/unsplash-paris.jpg' } }],
      },
    });

    const result = await getGooglePlaceImage('Paris', 'place123');

    expect(result).toBe('https://images.example.com/unsplash-paris.jpg');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('api.unsplash.com/search/photos?query=Paris'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Client-ID') }),
      })
    );
  });

  it('serves repeated GCS image cache reads from the shared TTL cache', async () => {
    const exists = jest.fn().mockResolvedValue([true]);
    const getMetadata = jest.fn().mockResolvedValue([
      { timeCreated: new Date(Date.now() - 1000).toISOString() },
    ]);
    const getSignedUrl = jest
      .fn()
      .mockResolvedValueOnce(['https://storage.example/paris-signed-1.jpg'])
      .mockResolvedValueOnce(['https://storage.example/paris-signed-2.jpg']);
    mockBucket.mockReturnValue({
      file: jest.fn(() => ({ exists, getMetadata, getSignedUrl })),
    });

    const first = await getUnsplashImage('Paris');
    const second = await getUnsplashImage('paris');

    expect(first).toBe('https://storage.example/paris-signed-1.jpg');
    expect(second).toBe('https://storage.example/paris-signed-1.jpg');
    expect(exists).toHaveBeenCalledTimes(1);
    expect(getMetadata).toHaveBeenCalledTimes(1);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('falls back to Unsplash when local GCS credentials cannot sign cached image URLs', async () => {
    const exists = jest.fn().mockResolvedValue([true]);
    const getMetadata = jest.fn().mockResolvedValue([
      { timeCreated: new Date(Date.now() - 1000).toISOString() },
    ]);
    const signingError = Object.assign(new Error('Cannot sign data without `client_email`.'), {
      name: 'SigningError',
    });
    const getSignedUrl = jest.fn().mockRejectedValue(signingError);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockBucket.mockReturnValue({
      file: jest.fn(() => ({ exists, getMetadata, getSignedUrl })),
    });
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        results: [{ urls: { regular: 'https://images.example.com/unsplash-paris.jpg' } }],
      },
    });

    const result = await getUnsplashImage('Paris');

    expect(result).toBe('https://images.example.com/unsplash-paris.jpg');
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
