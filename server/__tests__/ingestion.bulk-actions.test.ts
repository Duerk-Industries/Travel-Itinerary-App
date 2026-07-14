/// <reference types="jest" />
/// <reference types="node" />
import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const fixturePath = (...parts: string[]) =>
  path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'golden', ...parts);

// Each fixture has a distinct content hash, so uploading n distinct fixtures
// produces n review items rather than tripping the duplicate-suppression path.
const FIXTURES = ['plain-text-email.txt', 'html-booking-confirmation.html', 'pdf-single-item.pdf'];

const seedReviewItems = async (
  request: typeof import('supertest'),
  app: any,
  helpers: typeof import('./helpers'),
  auth: { Authorization: string },
  count: number
): Promise<string[]> => {
  if (count > FIXTURES.length) throw new Error(`seedReviewItems supports at most ${FIXTURES.length} items`);
  for (let i = 0; i < count; i += 1) {
    await request(app).post('/api/ingestion/upload').set(auth).attach('files', fixturePath(FIXTURES[i])).expect(202);
  }
  await helpers.waitFor(async () => {
    const review = await request(app).get('/api/ingestion/review-items').set(auth);
    return (review.body.items ?? []).length === count;
  // PDF normalization and the in-process worker can be CPU-bound when this
  // suite runs alongside the other ingestion suites; five seconds made this
  // setup race the worker even though the job eventually completed.
  }, 15000, 100);
  const review = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
  return review.body.items.map((item: any) => item.id);
};

describe('ingestion bulk actions', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('rejects non-array, empty, or oversized id payloads with 400', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Val',
      lastName: 'Idate',
      email: 'bulk-validation@example.com',
      password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).post('/api/ingestion/review-items/bulk-delete').set(auth).send({}).expect(400);
    await request(app).post('/api/ingestion/review-items/bulk-delete').set(auth).send({ ids: [] }).expect(400);
    await request(app)
      .post('/api/ingestion/review-items/bulk-delete')
      .set(auth)
      .send({ ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) })
      .expect(400);

    await request(app)
      .post('/api/ingestion/review-items/bulk-assign')
      .set(auth)
      .send({ ids: ['x'] })
      .expect(400); // missing tripId
    await request(app)
      .post('/api/ingestion/review-items/bulk-assign')
      .set(auth)
      .send({ tripId: 'trip-x' })
      .expect(400); // missing ids
  });

  it('denies free users from bulk endpoints', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token } = await helpers.registerAndLoginWebUser({
      firstName: 'Free',
      lastName: 'Bulk',
      email: 'free-bulk@example.com',
      password: 'secret123',
    });
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post('/api/ingestion/review-items/bulk-delete')
      .set(auth)
      .send({ ids: ['x'] })
      .expect(403);
    await request(app)
      .post('/api/ingestion/review-items/bulk-assign')
      .set(auth)
      .send({ ids: ['x'], tripId: 'trip-x' })
      .expect(403);
  });

  it('soft-deletes multiple review items and reports unknown ids without aborting the batch', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Bulk',
      lastName: 'Delete',
      email: 'bulk-delete@example.com',
      password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    const ids = await seedReviewItems(request, app, helpers, auth, 2);
    const unknownId = '00000000-0000-0000-0000-000000000000';

    const res = await request(app)
      .post('/api/ingestion/review-items/bulk-delete')
      .set(auth)
      .send({ ids: [...ids, unknownId, ids[0]] }) // includes unknown + duplicate
      .expect(207);

    // Duplicate id is collapsed before processing.
    expect(res.body.deletedIds.sort()).toEqual([...ids].sort());
    expect(res.body.failed).toEqual([
      expect.objectContaining({ id: unknownId, reason: expect.stringContaining('not found') }),
    ]);

    const queue = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(queue.body.items).toHaveLength(0);
  });

  it('200s when every bulk-delete id succeeds', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'All',
      lastName: 'OK',
      email: 'bulk-delete-all-ok@example.com',
      password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    const ids = await seedReviewItems(request, app, helpers, auth, 1);
    const res = await request(app).post('/api/ingestion/review-items/bulk-delete').set(auth).send({ ids }).expect(200);
    expect(res.body.deletedIds).toEqual(ids);
    expect(res.body.failed).toEqual([]);
  });

  it('does not allow a user to bulk-delete another user\'s items', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const a = await helpers.registerAndLoginWebUser({
      firstName: 'Alice',
      lastName: 'Owner',
      email: 'bulk-isolation-a@example.com',
      password: 'secret123',
    });
    const b = await helpers.registerAndLoginWebUser({
      firstName: 'Bobby',
      lastName: 'Stranger',
      email: 'bulk-isolation-b@example.com',
      password: 'secret123',
    });
    await helpers.setUserTierInDb(a.userId, 'premium');
    await helpers.setUserTierInDb(b.userId, 'premium');
    const authA = { Authorization: `Bearer ${a.token}` };
    const authB = { Authorization: `Bearer ${b.token}` };

    const idsA = await seedReviewItems(request, app, helpers, authA, 1);
    const res = await request(app)
      .post('/api/ingestion/review-items/bulk-delete')
      .set(authB) // Wrong user.
      .send({ ids: idsA })
      .expect(207);
    expect(res.body.deletedIds).toEqual([]);
    expect(res.body.failed).toEqual([expect.objectContaining({ id: idsA[0] })]);

    // A's items still present.
    const queueA = await request(app).get('/api/ingestion/review-items').set(authA).expect(200);
    expect(queueA.body.items).toHaveLength(1);
  });

  it('bulk-assigns multiple items to a trip and surfaces partial failures', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Bulk',
      lastName: 'Assign',
      email: 'bulk-assign@example.com',
      password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    const groupsRes = await request(app).get('/api/groups').set(auth).expect(200);
    const groupId = groupsRes.body[0].id;
    const tripRes = await request(app)
      .post('/api/trips')
      .set(auth)
      .send({ name: 'Bulk Assign Trip', groupId, currency: 'USD' })
      .expect(201);
    const tripId = tripRes.body.id as string;

    const ids = await seedReviewItems(request, app, helpers, auth, 2);

    // First, assign one item individually so the second bulk attempt for it
    // surfaces the "already assigned" failure path while the other id succeeds.
    await request(app)
      .post(`/api/ingestion/review-items/${ids[0]}/assign`)
      .set(auth)
      .send({ tripId })
      .expect(201);

    const res = await request(app)
      .post('/api/ingestion/review-items/bulk-assign')
      .set(auth)
      .send({ ids, tripId })
      .expect(207);

    expect(res.body.assigned).toEqual([
      expect.objectContaining({ id: ids[1], tripId }),
    ]);
    expect(res.body.failed).toEqual([
      expect.objectContaining({ id: ids[0], reason: expect.stringContaining('already assigned') }),
    ]);

    const queue = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(queue.body.items).toHaveLength(0);
  });
});
