import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { readPlanningBundle } from '../src/services/planningBundleService';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

describe('P1 private planning contracts', () => {
  let userId: string, token: string, tripId: string, catalogId: string, outsider: string;
  beforeAll(async () => {
    process.env.TRIP_BUNDLE_VERSIONING = '1';
    await db.initDb(); await seedTiersForTest();
    ({ userId, token } = await registerAndLoginWebUser({ firstName: 'Planning', lastName: 'Owner', email: 'p1-owner@example.com', password: 'secret123' }));
    ({ token: outsider } = await registerAndLoginWebUser({ firstName: 'Other', lastName: 'Person', email: 'p1-other@example.com', password: 'secret123' }));
    const group = await request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send({ name: 'P1 group' }).expect(201);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`).send({ groupId: group.body.id, name: 'P1 Paris', destination: 'Paris', startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201);
    tripId = trip.body.id;
    catalogId = randomUUID();
    await queryBlog("INSERT INTO locations(id,name,source_type,category,search_name,payload) VALUES($1,'Garden','attraction','attraction','garden paris',$2)", [catalogId, JSON.stringify({ destinationKey: 'paris', destinationDisplayName: 'Paris', activityType: 'Sights & Landmarks', lat: 48.86, lon: 2.33, sourceUrl: 'https://en.wikipedia.org/wiki/Paris', sourceLabel: 'Wikipedia', popularityScore: 10 })]);
    await db.setFeatureFlag('planning_nearby', true, null); await db.setFeatureFlag('trip_bundle', true, null);
    clearFeatureFlagCacheForTesting();
  });
  afterAll(() => { delete process.env.TRIP_BUNDLE_VERSIONING; });
  it('replays a committed Add without duplicating and rejects key reuse with different input', async () => {
    const body = { tripId, catalogId, date: '2027-05-02' };
    const add = () => request(app).post('/api/activities').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'p1-add-operation-001').send(body);
    const first = await add().expect(201); const replay = await add().expect(201);
    expect(replay.body.id).toBe(first.body.id); expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await db.listActivities(userId, tripId)).filter(item => item.id === first.body.id)).toHaveLength(1);
    expect(first.body).toMatchObject({ lat: 48.86, coordinateSource: 'catalog', status: 'Proposed' });
    await request(app).post('/api/activities').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'p1-add-operation-001').send({ ...body, date: '2027-05-03' }).expect(409);
    await request(app).delete(`/api/activities/${first.body.id}`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'p1-add-operation-001').expect(204);
    await add().expect(409);
  });
  it('refuses Undo after a traveler edits the created activity', async () => {
    const result = await db.createCatalogActivity(userId, { tripId, catalogId, date: '2027-05-02', operationKey: 'p1-edited-operation-001' });
    await queryBlog('UPDATE tours SET notes=$2 WHERE id=$1', [result.activity.id, 'A traveler changed this']);
    await expect(db.undoCatalogActivity(userId, result.activity.id, 'p1-edited-operation-001')).rejects.toMatchObject({ code: 'ACTIVITY_CHANGED' });
  });
  it('checks access before conditional 304, skips child reads and invalidates direct repository writes', async () => {
    const first = await readPlanningBundle(userId, tripId);
    expect(first.bundle?.trip.id).toBe(tripId);
    const children = jest.spyOn(db, 'listActivities');
    expect((await readPlanningBundle(userId, tripId, undefined, first.etag)).bundle).toBeUndefined();
    expect(children).not.toHaveBeenCalled(); children.mockRestore();
    await request(app).get(`/api/trips/${tripId}/bundle`).set('Authorization', `Bearer ${outsider}`).set('If-None-Match', first.etag).expect(403);
    await queryBlog('UPDATE tours SET notes=$2 WHERE trip_id=$1', [tripId, 'Ingestion-style direct SQL mutation']);
    const changed = await readPlanningBundle(userId, tripId, undefined, first.etag);
    expect(changed.etag).not.toBe(first.etag); expect(changed.bundle).toBeDefined();
  });
  it('rejects arbitrary native map proxy inputs without contacting a provider', async () => {
    const upstream = jest.spyOn(globalThis, 'fetch');
    await request(app).get('/api/maps/static?address=private+address').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app).get('/api/maps/trip-day?points=[]').set('Authorization', `Bearer ${token}`).expect(400);
    expect(upstream).not.toHaveBeenCalled(); upstream.mockRestore();
  });
});
