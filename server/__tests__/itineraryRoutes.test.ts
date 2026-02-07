import request from 'supertest';
import axios from 'axios';
import { app } from '../src/app';
import * as firebase from '../src/db.firebase';
import * as auth from '../src/auth';

jest.mock('../src/auth');
jest.mock('axios');
jest.mock('../src/db.firebase');

const storageFileMock = {
  exists: jest.fn(async () => [true]),
  save: jest.fn(async () => undefined),
  getSignedUrl: jest.fn(async () => ['https://signed-url/mock']),
};
const storageBucketMock = {
  file: jest.fn(() => storageFileMock),
};

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({
    bucket: jest.fn(() => storageBucketMock),
  })),
}));

jest.mock('../src/env', () => ({
  getEnvValue: (key: string) => {
    if (key === 'UNSPLASH_ACCESS_KEY') return 'test-key';
    if (key === 'LOCATION_BUCKET') return 'travel-itinerary-app-483623.appspot.com';
    if (key === 'GCLOUD_PROJECT_ID') return 'travel-itinerary-app-483623';
    return null;
  },
  hasRunLocalFlag: () => false,
  isLocalEnv: () => false,
}));

describe('/api/itinerary/images', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  let docData: any = null;
  let docExists = false;

  beforeEach(() => {
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'test-user' };
      next();
    });
    docExists = false;
    docData = null;
    storageFileMock.exists.mockResolvedValue([true]);
    storageFileMock.getSignedUrl.mockResolvedValue(['https://signed-url/mock']);
    const doc = {
      get: jest.fn(async () => ({
        exists: docExists,
        data: () => docData,
      })),
      set: jest.fn(async (data) => {
        docExists = true;
        docData = data;
      }),
    };
    const collection = {
      doc: jest.fn(() => doc),
    };
    (firebase.getDb as jest.Mock).mockReturnValue({
      collection: jest.fn(() => collection),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and stores an unsplash image in storage', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('api.unsplash.com/photos/random')) {
        return Promise.resolve({ data: { urls: { regular: 'https://images.unsplash.com/new-photo' } } } as any);
      }
      if (url.includes('images.unsplash.com/new-photo')) {
        return Promise.resolve({ data: Buffer.from('img'), headers: { 'content-type': 'image/jpeg' } } as any);
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const res = await request(app).get('/api/itinerary/images?location=paris').expect(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.url).toBe('https://signed-url/mock');
    expect(storageFileMock.save).toHaveBeenCalled();
  });

  it('returns a cached storage image url when cache is valid', async () => {
    docExists = true;
    docData = {
      storagePath: 'images/unsplash/paris-1.jpg',
      sourceUrl: 'https://images.unsplash.com/paris',
      fetchedAt: Date.now() - 1000,
      expiresAt: Date.now() + 100000,
      provider: 'unsplash',
    };

    const res = await request(app).get('/api/itinerary/images?location=paris').expect(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.url).toBe('https://signed-url/mock');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('falls back to placeholder when image lookups fail', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Network down'));
    const res = await request(app).get('/api/itinerary/images?location=cairo').expect(200);
    expect(String(res.body.url)).toContain('images.unsplash.com/photo-1502920917128-1aa500764b0e');
  });
});
