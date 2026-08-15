/// <reference types="jest" />
/// <reference types="node" />

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('GET /api/admin/ingestion/shadow-parse-summary', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('is reachable by an admin and returns a well-formed summary', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token } = await helpers.makeAdminUser({
      firstName: 'Admin',
      lastName: 'User',
      email: 'shadow-parse-admin@example.com',
      password: 'secret123',
    });

    // Scope to a date window with no real captures rather than asserting on
    // whatever happens to already be sitting in this machine's local capture
    // archive from prior dev/test runs (this reads real disk state, not a
    // per-test fixture) — that keeps the assertion deterministic without
    // deleting or mocking around a developer's actual capture logs.
    const res = await request(app)
      .get('/api/admin/ingestion/shadow-parse-summary')
      .query({ dateFrom: '2000-01-01', dateTo: '2000-01-02' })
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(res.body).toEqual({
      sampleCount: 0,
      comparedSampleCount: 0,
      averageAgreementRate: null,
      byItemType: [],
      topMismatchedFields: [],
      source: 'local_capture_archive',
    });
  });

  it('rejects non-admin callers', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token } = await helpers.registerAndLoginWebUser({
      firstName: 'Regular',
      lastName: 'User',
      email: 'shadow-parse-regular@example.com',
      password: 'secret123',
    });

    await request(app)
      .get('/api/admin/ingestion/shadow-parse-summary')
      .set({ Authorization: `Bearer ${token}` })
      .expect(403);
  });
});
