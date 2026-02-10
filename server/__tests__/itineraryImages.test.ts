import request from 'supertest';
import { PassThrough } from 'stream';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser } from './helpers';
import * as googlePlaces from '../src/googlePlaces';

jest.mock('@google-cloud/storage', () => {
  const { PassThrough } = require('stream');
  class FakeFile {
    exists = async () => [false];
    getMetadata = async () => [{ timeCreated: new Date().toISOString() }];
    getSignedUrl = async () => ['https://example.com/cached.jpg'];
    createWriteStream = () => new PassThrough();
    delete = async () => undefined;
  }
  class FakeBucket {
    file = () => new FakeFile();
    getFiles = async () => [[]];
  }
  class Storage {
    bucket() {
      return new FakeBucket();
    }
  }
  return { Storage };
});

jest.mock('axios', () => {
  const { PassThrough } = require('stream');
  const axios: any = (config: any) => {
    if (config?.responseType === 'stream') {
      const stream = new PassThrough();
      stream.end('image-bytes');
      return Promise.resolve({ data: stream, headers: { 'content-type': 'image/jpeg' } });
    }
    return Promise.resolve({ data: {} });
  };
  axios.get = (url: string) => {
    if (url.includes('places.googleapis.com/v1/places/')) {
      return Promise.resolve({
        data: { id: 'place123', displayName: { text: 'Frida Kahlo Museum' }, photos: [{ name: 'photos/abc' }] },
      });
    }
    if (url.includes('maps.googleapis.com/maps/api/place/details/json')) {
      return Promise.resolve({ data: { result: { photos: [{ photo_reference: 'ref123' }] } } });
    }
    if (url.includes('maps.googleapis.com/maps/api/place/photo')) {
      return Promise.resolve({ status: 302, headers: { location: 'https://example.com/photo.jpg' } });
    }
    return Promise.resolve({ data: {} });
  };
  axios.post = () => Promise.resolve({ data: { places: [] } });
  return axios;
});

describe('GET /api/itinerary/images', () => {
  jest.setTimeout(30000);
  let pool: Pool;
  let token: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PLACE_MATCH_THRESHOLD = '0.75';
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash';

    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const login = await registerAndLoginWebUser(pool, {
      email: 'itinerary-image@example.com',
      firstName: 'Itinerary',
      lastName: 'Images',
      password: 'testtest',
    });
    token = login.token;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email = $1', ['itinerary-image@example.com']);
      await pool.end();
    }
    await closePool();
  });

  it('uses Google Places when a likely place match is found', async () => {
    jest.spyOn(googlePlaces, 'searchPlaceCandidates').mockResolvedValue([
      { placeId: 'place123', name: 'Frida Kahlo Museum', formattedAddress: 'Mexico City', types: [] },
    ]);

    const res = await request(app)
      .get('/api/itinerary/images')
      .set('Authorization', `Bearer ${token}`)
      .query({
        location: 'Mexico City',
        day: '2026-03-03',
        context: 'Frida Kahlo Museum',
      })
      .expect(200);

    expect(res.body.provider).toBe('google');
    expect(res.body.url).toBeTruthy();
  });
});
