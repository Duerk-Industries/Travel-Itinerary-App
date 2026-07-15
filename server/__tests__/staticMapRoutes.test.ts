/// <reference types="jest" />
/// <reference types="node" />

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/static-map-test';
  process.env.GOOGLE_STATIC_MAPS_API_KEY = 'server-only-map-key';
  process.env.WEB_URL = 'http://localhost:8081';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('Static Maps proxy', () => {
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

  it('proxies authenticated map images, caches them, and counts only the upstream miss', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { getApiUsageSummary } = require('../src/apis/usageLimiter') as typeof import('../src/apis/usageLimiter');
    const user = { firstName: 'Map', lastName: 'Viewer', email: 'map-viewer@example.com', password: 'secret123' };
    const { token } = await helpers.registerAndLoginWebUser(user);

    const body = Buffer.from('fake-png');
    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
      arrayBuffer: async () => body,
    } as Response);

    const path = '/api/maps/static?address=1%20Main%20Street%2C%20Boston';
    await request(app).get(path).set({ Authorization: `Bearer ${token}` }).expect(200);
    await request(app).get(path).set({ Authorization: `Bearer ${token}` }).expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstreamUrl).toContain('maps.googleapis.com/maps/api/staticmap');
    expect(upstreamUrl).toContain('key=server-only-map-key');
    expect(upstreamUrl).not.toContain('EXPO_PUBLIC');

    const usage = await getApiUsageSummary();
    expect(usage.find((entry) => entry.provider === 'GOOGLE_STATIC_MAPS' && entry.caller === 'STATIC_MAP_PREVIEW')?.used).toBe(1);
  });
});
