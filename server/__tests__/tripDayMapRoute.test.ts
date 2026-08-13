/// <reference types="jest" />
/// <reference types="node" />

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/trip-day-map-test';
  process.env.GOOGLE_STATIC_MAPS_API_KEY = 'server-only-map-key';
  process.env.WEB_URL = 'http://localhost:8081';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const points = (n: number) =>
  Array.from({ length: n }).map((_, i) => ({ kind: 'activity', address: `Stop ${i}` }));

const mockFetchOk = () => {
  const body = Buffer.from('fake-png');
  return jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => body,
  } as Response);
};

describe('Trip-day map proxy (GET /api/maps/trip-day)', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is disabled by default (feature flag off) and never calls upstream', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const db = require('../src/db') as typeof import('../src/db');
    // Explicit, not just relying on the YAML seed default — makes this test's
    // precondition self-contained regardless of what other tests in this
    // file (or the 60s in-process flag cache) have done.
    await db.setFeatureFlag('trip_day_map', false, null);
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token } = await helpers.registerAndLoginWebUser({
      firstName: 'Map',
      lastName: 'Off',
      email: 'map-off@example.com',
      password: 'secret123',
    });
    const fetchMock = mockFetchOk();

    const res = await request(app)
      .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify(points(2)))}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(403);

    expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    await request(app)
      .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify(points(1)))}`)
      .expect(401);
  });

  describe('with the flag enabled', () => {
    let token: string;

    beforeEach(async () => {
      const db = require('../src/db') as typeof import('../src/db');
      await db.setFeatureFlag('trip_day_map', true, null);
      const helpers = require('./helpers') as typeof import('./helpers');
      const user = await helpers.registerAndLoginWebUser({
        firstName: 'Map',
        lastName: 'On',
        email: 'map-on@example.com',
        password: 'secret123',
      });
      token = user.token;
    });

    it('renders labeled, colored markers for each point and records exactly one upstream call across two identical requests (cache hit)', async () => {
      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      const { getApiUsageSummary } = require('../src/apis/usageLimiter') as typeof import('../src/apis/usageLimiter');
      const fetchMock = mockFetchOk();

      const body = [
        { kind: 'flight', address: 'SFO' },
        { kind: 'lodging', address: 'Selina Puerto Viejo' },
        { kind: 'activity', address: 'Arenal Volcano' },
        { kind: 'car_rental', address: 'Liberia Airport' },
      ];
      const qs = `points=${encodeURIComponent(JSON.stringify(body))}`;

      await request(app).get(`/api/maps/trip-day?${qs}`).set({ Authorization: `Bearer ${token}` }).expect(200);
      await request(app).get(`/api/maps/trip-day?${qs}`).set({ Authorization: `Bearer ${token}` }).expect(200);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const upstreamUrl = String(fetchMock.mock.calls[0]?.[0]);
      const parsed = new URL(upstreamUrl);
      expect(`${parsed.origin}${parsed.pathname}`).toBe('https://maps.googleapis.com/maps/api/staticmap');
      expect(parsed.searchParams.get('key')).toBe('server-only-map-key');
      expect(upstreamUrl).not.toContain('EXPO_PUBLIC');
      // No route/path line in v1 — see implementation-plan-trip-day-map.md for why.
      expect(parsed.searchParams.has('path')).toBe(false);
      expect(parsed.searchParams.getAll('markers')).toEqual([
        'color:blue|label:A|SFO',
        'color:orange|label:B|Selina Puerto Viejo',
        'color:green|label:C|Arenal Volcano',
        'color:purple|label:D|Liberia Airport',
      ]);

      const usage = await getApiUsageSummary();
      expect(
        usage.find((entry) => entry.provider === 'GOOGLE_STATIC_MAPS' && entry.caller === 'TRIP_DAY_MAP')?.used
      ).toBe(1);
      // The pre-existing single-address caller must stay unaffected by this new route.
      expect(
        usage.find((entry) => entry.provider === 'GOOGLE_STATIC_MAPS' && entry.caller === 'STATIC_MAP_PREVIEW')?.used
      ).toBeUndefined();
    });

    it('truncates to the configured max point count instead of erroring', async () => {
      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      const fetchMock = mockFetchOk();

      await request(app)
        .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify(points(20)))}`)
        .set({ Authorization: `Bearer ${token}` })
        .expect(200);

      const upstreamUrl = String(fetchMock.mock.calls[0]?.[0]);
      const markerCount = (upstreamUrl.match(/markers=/g) ?? []).length;
      expect(markerCount).toBe(12); // caching.googleStaticMaps.maxPointsPerTripDayMap in api-limits.yaml
    });

    it('rejects malformed JSON in the points param', async () => {
      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      await request(app)
        .get('/api/maps/trip-day?points=not-json')
        .set({ Authorization: `Bearer ${token}` })
        .expect(400);
    });

    it('rejects a request with no usable points', async () => {
      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      await request(app)
        .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify([{ kind: 'activity', address: '' }]))}`)
        .set({ Authorization: `Bearer ${token}` })
        .expect(400);
    });

    it('returns 503 when no API key is configured, without touching the rate limiter', async () => {
      delete process.env.GOOGLE_STATIC_MAPS_API_KEY;
      delete process.env.GOOGLE_MAPS_API_KEY;
      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      const { getApiUsageSummary } = require('../src/apis/usageLimiter') as typeof import('../src/apis/usageLimiter');

      await request(app)
        .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify(points(1)))}`)
        .set({ Authorization: `Bearer ${token}` })
        .expect(503);

      const usage = await getApiUsageSummary();
      expect(
        usage.find((entry) => entry.provider === 'GOOGLE_STATIC_MAPS' && entry.caller === 'TRIP_DAY_MAP')?.used
      ).toBeUndefined();
    });

    it('returns 429 once the TRIP_DAY_MAP caller cap is exhausted', async () => {
      const { reserveApiUsageOrThrow } = require('../src/apis/usageLimiter') as typeof import('../src/apis/usageLimiter');
      // api-limits.yaml: GOOGLE_STATIC_MAPS.callers.TRIP_DAY_MAP = 300.
      for (let i = 0; i < 300; i += 1) {
        await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller: 'TRIP_DAY_MAP' });
      }

      const request = require('supertest') as typeof import('supertest');
      const { app } = require('../src/app') as typeof import('../src/app');
      const fetchMock = mockFetchOk();

      await request(app)
        .get(`/api/maps/trip-day?points=${encodeURIComponent(JSON.stringify(points(1)))}`)
        .set({ Authorization: `Bearer ${token}` })
        .expect(429);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
