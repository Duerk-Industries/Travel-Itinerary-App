import request from 'supertest';
import { app } from '../src/app';
import axios from 'axios';
import * as firebase from '../src/db.firebase';
import * as auth from '../src/auth';

jest.mock('../src/auth');
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../src/db.firebase');
const mockedGetDb = firebase.getDb as jest.Mock;

jest.mock('../src/env', () => ({
  getEnvValue: (key: string) => {
    if (key === 'UNSPLASH_ACCESS_KEY') return 'test-key';
    return null;
  },
  hasRunLocalFlag: () => false,
  isLocalEnv: () => false,
}));

describe('/api/itinerary/images', () => {
  let docData: any = null;
  let docExists = false;

  beforeEach(() => {
    (auth.authenticate as jest.Mock).mockImplementation((req, res, next) => {
      (req as any).user = { userId: 'test-user' };
      next();
    });

    docExists = false;
    docData = null;
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
    mockedGetDb.mockReturnValue({
      collection: jest.fn(() => collection),
    });
  });

  afterEach(() => {
    mockedAxios.get.mockClear();
    mockedGetDb.mockClear();
    jest.restoreAllMocks();
  });

  it('fetches a new image and caches it', async () => {
    const imageUrl = 'https://images.unsplash.com/mock-photo';
    mockedAxios.get.mockResolvedValue({ data: { urls: { regular: imageUrl } } });

    const res = await request(app).get('/api/itinerary/images?location=paris').expect(200);

    expect(res.body.url).toBe(imageUrl);
    expect(res.body.cached).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns a cached image if available and not expired', async () => {
    docExists = true;
    docData = {
      url: 'https://images.unsplash.com/cached-photo',
      fetchedAt: Date.now() - 10000,
    };

    const res = await request(app).get('/api/itinerary/images?location=london').expect(200);

    expect(res.body.url).toBe(docData.url);
    expect(res.body.cached).toBe(true);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('retries on fetch failure and eventually succeeds', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const imageUrl = 'https://images.unsplash.com/retry-photo';
    mockedAxios.get
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ data: { urls: { regular: imageUrl } } });

    const res = await request(app).get('/api/itinerary/images?location=tokyo').expect(200);

    expect(res.body.url).toBe(imageUrl);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('falls back to "travel" query on repeated failures', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fallbackUrl = 'https://images.unsplash.com/fallback-photo';
    
    mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('query=berlin')) {
            return Promise.reject(new Error('Network error'));
        }
        if (url.includes('query=travel')) {
            return Promise.resolve({ data: { urls: { regular: fallbackUrl } } });
        }
        return Promise.reject(new Error('Unexpected fetch call'));
    });

    const res = await request(app).get('/api/itinerary/images?location=berlin').expect(200);

    expect(res.body.url).toBe(fallbackUrl);
    // 2 attempts for 'berlin' + 1 for 'travel'
    expect(mockedAxios.get).toHaveBeenCalledTimes(3); 
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns placeholder when all fetches fail', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedAxios.get.mockRejectedValue(new Error('Major network failure'));
    const placeholder = 'https://images.unsplash.com/photo-1502920917128-1aa500764b0e?auto=format&fit=crop&w=1200&q=80';

    const res = await request(app).get('/api/itinerary/images?location=cairo').expect(200);
    
    expect(res.body.url).toBe(placeholder);
    // 2 attempts for 'cairo' + 1 for 'travel'
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});