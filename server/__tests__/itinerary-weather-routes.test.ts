/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, getUsageCounter, initDb } from '../src/db';
import { cleanupTestUsersByEmail, registerAndLoginWebUser, seedTiersForTest } from './helpers';

const TS = Date.now();
const USER_EMAIL = `overview-weather-test+${TS}@example.com`;

describe('Itinerary overview weather route', () => {
  let token = '';
  let userId = '';
  const originalFetch = global.fetch;
  let fetchMock: jest.SpyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const user = await registerAndLoginWebUser({
      firstName: 'Weather',
      lastName: 'Overview',
      email: USER_EMAIL,
      password: 'TestPass1!',
    });
    token = user.token;
    userId = user.userId;
  });

  beforeEach(() => {
    if (!global.fetch) {
      (global as any).fetch = jest.fn();
    }
    fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async (...args: any[]) => {
      const input = args[0];
      const url = String(input);
      if (url.includes('geocoding-api.open-meteo.com')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                latitude: 48.8566,
                longitude: 2.3522,
                name: 'Paris',
                country: 'France',
              },
            ],
          }),
        } as any;
      }
      if (url.includes('api.open-meteo.com')) {
        return {
          ok: true,
          json: async () => ({
            daily: {
              time: ['2026-03-24', '2026-03-25'],
              weather_code: [1, 61],
              temperature_2m_max: [18.2, 16.7],
            },
          }),
        } as any;
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    if (!originalFetch) {
      delete (global as any).fetch;
    }
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([USER_EMAIL]);
    await closePool();
  });

  it('returns daily weather and records usage statistics', async () => {
    const res = await request(app)
      .post('/api/itinerary/weather/overview')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId: 'trip-weather-1',
        days: [
          { date: '2026-03-24', location: 'Paris, France' },
          { date: '2026-03-25', location: 'Paris, France' },
        ],
      })
      .expect(200);

    expect(res.body.weather).toEqual([
      expect.objectContaining({
        date: '2026-03-24',
        requestedLocation: 'Paris, France',
        resolvedLocation: 'Paris, France',
        icon: '🌤',
        temperatureHighC: 18,
      }),
      expect.objectContaining({
        date: '2026-03-25',
        requestedLocation: 'Paris, France',
        resolvedLocation: 'Paris, France',
        icon: '🌧',
        temperatureHighC: 17,
      }),
    ]);

    const monthKey = new Date().toISOString().slice(0, 7);
    expect(await getUsageCounter(userId, 'overview_weather_requests', monthKey)).toBe(1);
    expect(await getUsageCounter(userId, 'api_calls_open_meteo', monthKey)).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
