import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { isFeatureEnabled, clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

// The planning contracts that the Firestore adapter must honour exactly as Postgres does. Unlike
// planningP1Contracts.test.ts this uses no direct SQL, so it runs on either adapter:
//   pg-mem (default):  npx jest ... planning.adapter-parity
//   Firestore emulator: JEST_DB_PROVIDER=firebase FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 \
//                       GCLOUD_PROJECT_ID=<demo project> npx jest ... planning.adapter-parity
const isFirebase = () => db.getCurrentDbProvider() === 'firebase';

const seedCatalogPlace = async (id: string) => {
  const payload = { destinationKey: 'paris', destinationDisplayName: 'Paris', activityType: 'Sights & Landmarks', lat: 48.86, lon: 2.33, sourceUrl: 'https://en.wikipedia.org/wiki/Paris', sourceLabel: 'Wikipedia', popularityScore: 10 };
  if (isFirebase()) {
    const { getDb } = require('../src/db.firebase') as typeof import('../src/db.firebase');
    await getDb().collection('locations').doc(id).set({ name: 'Garden', sourceType: 'attraction', category: 'attraction', searchName: 'garden paris', payload });
  } else {
    const { queryBlog } = require('../src/db.postgres') as typeof import('../src/db.postgres');
    await queryBlog("INSERT INTO locations(id,name,source_type,category,search_name,payload) VALUES($1,'Garden','attraction','attraction','garden paris',$2)", [id, JSON.stringify(payload)]);
  }
};

// insertLodging does not accept coordinates (they come from the catalog or a manual pin), so the
// fixture writes them the way the adapter stores them.
const setLodgingCoordinates = async (id: string) => {
  if (isFirebase()) {
    const { getDb } = require('../src/db.firebase') as typeof import('../src/db.firebase');
    await getDb().collection('lodgings').doc(id).update({ lat: 48.86, lng: 2.33, coordinateSource: 'manual' });
  } else {
    const { queryBlog } = require('../src/db.postgres') as typeof import('../src/db.postgres');
    await queryBlog("UPDATE lodgings SET lat=48.86,lng=2.33,coordinate_source='manual' WHERE id=$1", [id]);
  }
};

describe('planning contracts hold on the active database adapter', () => {
  const run = randomUUID().slice(0, 8);
  let userId = '', token = '', outsider = '', tripId = '', catalogId = '';
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.TRIP_BUNDLE_VERSIONING = '1';
    await db.initDb();
    await seedTiersForTest();
    ({ userId, token } = await registerAndLoginWebUser({ firstName: 'Parity', lastName: 'Owner', email: `parity-owner-${run}@example.com`, password: 'secret123' }));
    ({ token: outsider } = await registerAndLoginWebUser({ firstName: 'Parity', lastName: 'Other', email: `parity-other-${run}@example.com`, password: 'secret123' }));
    const group = await request(app).post('/api/groups').set(auth()).send({ name: 'Parity group' }).expect(201);
    const trip = await request(app).post('/api/trips').set(auth()).send({ groupId: group.body.id, name: 'Parity Paris', destination: 'Paris', startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201);
    tripId = trip.body.id;
    catalogId = randomUUID();
    await seedCatalogPlace(catalogId);
    await db.setFeatureFlag('planning_nearby', true, null);
    await db.setFeatureFlag('trip_bundle', true, null);
    await db.setFeatureFlag('planning_day_order', true, null);
    clearFeatureFlagCacheForTesting();
  });
  afterAll(() => { delete process.env.TRIP_BUNDLE_VERSIONING; });

  it('evaluates cohorts per caller; global off and expired or broken rules deny', async () => {
    const key = 'planning_nearby';
    const setCohort = async (userIds: string[], retireAfter = '2099-01-01T00:00:00.000Z') => {
      await db.setAdminSetting({ key: `feature_cohort:${key}`, value: JSON.stringify({ userIds, owner: 'Parity', retireAfter }), updatedBy: null });
      clearFeatureFlagCacheForTesting();
    };
    await setCohort([userId]);
    expect(await isFeatureEnabled(key, userId)).toBe(true);
    expect(await isFeatureEnabled(key, randomUUID())).toBe(false);
    expect((await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set(auth()).expect(200)).body.nearby).toBe(true);
    await setCohort([]);
    expect((await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set(auth()).expect(200)).body.nearby).toBe(false);
    await request(app).get(`/api/activities/nearby?tripId=${tripId}`).set(auth()).expect(404);
    await setCohort([userId], '2000-01-01T00:00:00.000Z');
    expect(await isFeatureEnabled(key, userId)).toBe(false);
    await db.setAdminSetting({ key: `feature_cohort:${key}`, value: '{broken', updatedBy: null });
    clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled(key, userId)).toBe(false);
    await db.setAdminSetting({ key: `feature_cohort:${key}`, value: 'null', updatedBy: null });
    clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled(key, userId)).toBe(true);
  });

  it('replays a committed Add without duplicating, rejects key reuse, and refuses Undo after an edit', async () => {
    const body = { tripId, catalogId, date: '2027-05-02' };
    const add = (key: string, payload = body) => request(app).post('/api/activities').set(auth()).set('Idempotency-Key', key).send(payload);
    const first = await add(`parity-add-${run}-1`).expect(201);
    const replay = await add(`parity-add-${run}-1`).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await db.listActivities(userId, tripId)).filter(item => item.id === first.body.id)).toHaveLength(1);
    expect(first.body).toMatchObject({ lat: 48.86, coordinateSource: 'catalog', status: 'Proposed' });
    await add(`parity-add-${run}-1`, { ...body, date: '2027-05-03' }).expect(409);

    const edited = await add(`parity-add-${run}-2`).expect(201);
    await request(app).patch(`/api/activities/${edited.body.id}`).set(auth()).send({ notes: 'A traveler changed this' }).expect(200);
    await expect(db.undoCatalogActivity(userId, edited.body.id, `parity-add-${run}-2`)).rejects.toMatchObject({ code: 'ACTIVITY_CHANGED' });

    await request(app).delete(`/api/activities/${first.body.id}`).set(auth()).set('Idempotency-Key', `parity-add-${run}-1`).expect(204);
    await add(`parity-add-${run}-1`).expect(409);
  });

  it('checks access before a conditional 304 and changes the version when the plan changes', async () => {
    const first = await request(app).get(`/api/trips/${tripId}/bundle`).set(auth()).expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    expect(first.body.trip.id).toBe(tripId);
    await request(app).get(`/api/trips/${tripId}/bundle`).set(auth()).set('If-None-Match', etag).expect(304);
    await request(app).get(`/api/trips/${tripId}/bundle`).set(auth(outsider)).set('If-None-Match', etag).expect(403);
    const created = await request(app).post('/api/activities').set(auth()).send({ tripId, date: '2027-05-04', name: 'Version bump', startLocation: 'Louvre', startTime: '10:00', duration: '1h', cost: '0', status: 'Proposed' }).expect(201);
    const changed = await request(app).get(`/api/trips/${tripId}/bundle`).set(auth()).set('If-None-Match', etag).expect(200);
    expect(changed.headers.etag).not.toBe(etag);
    expect(changed.body.tours.map((t: { id: string }) => t.id)).toContain(created.body.id);
  });

  it('orders a day atomically and refuses a stale expected order', async () => {
    const day = '2027-05-05';
    const make = (name: string, startTime: string) => request(app).post('/api/activities').set(auth()).send({ tripId, date: day, name, startLocation: 'Paris', startTime, duration: '1h', cost: '0', status: 'Proposed' }).expect(201);
    const a = (await make('Order A', '09:00')).body.id, b = (await make('Order B', '10:00')).body.id;
    const put = (orderedIds: string[], expectedIds: string[]) => request(app).put('/api/activities/day-order').set(auth()).send({ tripId, date: day, orderedIds, expectedIds });
    await put([b, a], [a, b]).expect(200);
    const stale = await put([a, b], [a, b]);
    expect(stale.status).toBe(409);
  });

  it('keeps lodging coordinates on unrelated edits and clears them when the address changes', async () => {
    const lodging = await db.insertLodging({ userId, tripId, status: 'Proposed', name: 'Coordinate hotel', checkInDate: '2027-05-01', checkOutDate: '2027-05-03', rooms: 1, totalCost: 0, costPerNight: 0, address: 'Original address' });
    await setLodgingCoordinates(lodging.id);
    expect(await db.getLodgingById(lodging.id)).toMatchObject({ lat: 48.86, lng: 2.33, coordinateSource: 'manual' });
    await db.updateLodging(lodging.id, userId, { notes: 'Keep this location' });
    expect(await db.getLodgingById(lodging.id)).toMatchObject({ lat: 48.86, lng: 2.33, coordinateSource: 'manual' });
    await db.updateLodging(lodging.id, userId, { address: 'New address' });
    expect(await db.getLodgingById(lodging.id)).toMatchObject({ lat: null, lng: null, coordinateSource: null });
  });

  it('rejects arbitrary native map proxy inputs without contacting a provider', async () => {
    const upstream = jest.spyOn(globalThis, 'fetch');
    await request(app).get('/api/maps/static?address=private+address').set(auth()).expect(400);
    await request(app).get('/api/maps/trip-day?points=[]').set(auth()).expect(400);
    expect(upstream).not.toHaveBeenCalled();
    upstream.mockRestore();
  });
});
