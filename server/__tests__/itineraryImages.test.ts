/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { PassThrough } from 'stream';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, cleanupTestUsersByEmail } from './helpers';

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
    if (url.includes('api.unsplash.com/search/photos')) {
      return Promise.resolve({
        data: {
          results: [{ urls: { regular: 'https://images.example.com/unsplash-museum.jpg' } }],
        },
      });
    }
    return Promise.resolve({ data: {} });
  };
  return axios;
});

describe('GET /api/itinerary/images', () => {
  jest.setTimeout(30000);
  let token: string;
  const testEmail = 'itinerary-image@example.com';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash';

    await initDb();
    const login = await registerAndLoginWebUser({
      email: testEmail,
      firstName: 'Itinerary',
      lastName: 'Images',
      password: 'testtest',
    });
    token = login.token;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([testEmail]);
    await closePool();
  });

  it('uses Unsplash for itinerary image resolution', async () => {
    const res = await request(app)
      .get('/api/itinerary/images')
      .set('Authorization', `Bearer ${token}`)
      .query({
        location: 'Mexico City',
        day: '2026-03-03',
        context: 'Frida Kahlo Museum',
      })
      .expect(200);

    expect(res.body.provider).toBe('unsplash');
    expect(res.body.url).toBeTruthy();
  });
});
