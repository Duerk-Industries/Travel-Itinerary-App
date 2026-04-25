/**
 * Unit test for the Postgres idempotency adapter functions.
 * Validates that duplicate inserts under the same key don't create duplicate
 * rows (ON CONFLICT DO NOTHING), and that complete/fail transitions update
 * the same row rather than creating siblings.
 *
 * Runs under the pg-mem-backed `memory` DB mode so it's hermetic. Uses the
 * normal registration + trip-creation helpers to satisfy FK constraints.
 */

import request from 'supertest';

const ORIGINAL_DB_PROVIDER = process.env.DB_PROVIDER;
const ORIGINAL_USE_IN_MEMORY_DB = process.env.USE_IN_MEMORY_DB;

describe('postgres generation_idempotency adapter', () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    const { initDb } = require('../src/db');
    await initDb();
    const { app } = require('../src/app');
    const { registerAndLoginWebUser } = require('./helpers');
    const stamp = Date.now();
    const user = await registerAndLoginWebUser({
      firstName: 'Idem',
      lastName: 'Test',
      email: `idem-test-${stamp}@example.com`,
      password: 'TestPass1!',
    });
    userId = user.userId;
    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Idem Group ${stamp}` })
      .expect(201);
    const groupId = groupRes.body.id ?? groupRes.body.group?.id;
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Idem Trip ${stamp}`, groupId, endDate: '2099-12-31' })
      .expect(201);
    tripId = tripRes.body.id ?? tripRes.body.trip?.id;
  });

  afterAll(async () => {
    if (ORIGINAL_DB_PROVIDER === undefined) delete process.env.DB_PROVIDER;
    else process.env.DB_PROVIDER = ORIGINAL_DB_PROVIDER;
    if (ORIGINAL_USE_IN_MEMORY_DB === undefined) delete process.env.USE_IN_MEMORY_DB;
    else process.env.USE_IN_MEMORY_DB = ORIGINAL_USE_IN_MEMORY_DB;
    const { closePool } = require('../src/db');
    await closePool();
  });

  it('reserve-then-reserve with same key is a no-op (no duplicate row)', async () => {
    const db = require('../src/db');
    const params = {
      key: `idem-test-${Date.now()}-a`,
      userId,
      tripId,
      usageKey: 'ai_itinerary_generations',
      windowKey: '2026-04',
    };
    const first = await db.reserveGenerationIdempotency(params);
    expect(first.created).toBe(true);
    expect(first.record?.status).toBe('pending');

    const second = await db.reserveGenerationIdempotency(params);
    expect(second.record?.status).toBe('pending');
    expect(second.record?.key).toBe(params.key);
  });

  it('complete transitions the row to status=completed with a response body', async () => {
    const db = require('../src/db');
    const key = `idem-test-${Date.now()}-b`;
    await db.reserveGenerationIdempotency({
      key,
      userId,
      tripId,
      usageKey: 'ai_itinerary_generations',
      windowKey: '2026-04',
    });
    await db.completeGenerationIdempotency(key, { jobId: 'x', status: 'completed' }, 'ref-1');
    const row = await db.getGenerationIdempotency(key);
    expect(row?.status).toBe('completed');
    expect(row?.resultRef).toBe('ref-1');
    expect(row?.responseBody).toMatchObject({ jobId: 'x', status: 'completed' });
  });

  it('fail transitions the row to status=failed with an error message', async () => {
    const db = require('../src/db');
    const key = `idem-test-${Date.now()}-c`;
    await db.reserveGenerationIdempotency({
      key,
      userId,
      tripId,
      usageKey: 'ai_itinerary_generations',
      windowKey: '2026-04',
    });
    await db.failGenerationIdempotency(key, 'provider timeout');
    const row = await db.getGenerationIdempotency(key);
    expect(row?.status).toBe('failed');
    expect(row?.errorMessage).toBe('provider timeout');
  });

  it('getGenerationIdempotency returns null for unknown keys', async () => {
    const db = require('../src/db');
    const row = await db.getGenerationIdempotency(`no-such-key-${Date.now()}`);
    expect(row).toBeNull();
  });
});
