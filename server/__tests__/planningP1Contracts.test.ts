import { notificationRepository } from '../src/services/notificationRepository';
import { putNotificationWork } from '../src/services/notificationWorkRepository';
import { runPlanningNotifications } from '../src/services/planningNotificationScheduler';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { docs, firestore, isFirebase, sql } from './providerRows';
import { isFeatureEnabled, clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { readPlanningBundle } from '../src/services/planningBundleService';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

// Direct writes below stand in for non-API writers (ingestion, scripts); they go through whichever
// adapter is active so the suite runs on pg-mem and on the Firestore emulator.
const seedCatalogPlace = async (id: string) => {
  const payload = { destinationKey: 'paris', destinationDisplayName: 'Paris', activityType: 'Sights & Landmarks', lat: 48.86, lon: 2.33, sourceUrl: 'https://en.wikipedia.org/wiki/Paris', sourceLabel: 'Wikipedia', popularityScore: 10 };
  if (isFirebase()) await firestore().collection('locations').doc(id).set({ name: 'Garden', sourceType: 'attraction', category: 'attraction', searchName: 'garden paris', payload });
  else await sql("INSERT INTO locations(id,name,source_type,category,search_name,payload) VALUES($1,'Garden','attraction','attraction','garden paris',$2)", [id, JSON.stringify(payload)]);
};
const changeActivityNotes = async (where: { id?: string; tripId?: string }, notes: string) => {
  if (isFirebase()) {
    if (where.id) await firestore().collection('tours').doc(where.id).update({ notes });
    else await Promise.all((await firestore().collection('tours').where('tripId', '==', where.tripId).get()).docs.map(doc => doc.ref.update({ notes })));
  } else if (where.id) await sql('UPDATE tours SET notes=$2 WHERE id=$1', [where.id, notes]);
  else await sql('UPDATE tours SET notes=$2 WHERE trip_id=$1', [where.tripId, notes]);
};
const setLodgingCoordinates = async (id: string) => {
  if (isFirebase()) await firestore().collection('lodgings').doc(id).update({ lat: 48.86, lng: 2.33, coordinateSource: 'manual' });
  else await sql("UPDATE lodgings SET lat=48.86,lng=2.33,coordinate_source='manual' WHERE id=$1", [id]);
};
type Work = { id: string; due_at: number; data: { targetUserId?: string; day: string } };
const digestChildren = async (): Promise<Work[]> => isFirebase()
  ? (await docs('notification_work', [['kind', 'digest'], ['completed', false]])).map(row => ({ id: row._id, due_at: row.dueAt, data: row.data }))
  : (await sql("SELECT id,due_at,data FROM notification_work WHERE kind='digest' AND completed=false")).rows.map((row: Work) => ({ ...row, due_at: Number(row.due_at) }));
const workDueAt = async (id: string): Promise<number> => (await digestChildren()).find(row => row.id === id)!.due_at;
const inboxRowsFor = async (userId: string, dedupeKey: string) => isFirebase()
  ? docs('notifications', [['userId', userId], ['dedupeKey', dedupeKey]])
  : (await sql('SELECT id FROM notifications WHERE user_id=$1 AND dedupe_key=$2', [userId, dedupeKey])).rows;
const rerunParent = async (id: string, dueAt: number) => {
  if (isFirebase()) await firestore().collection('notification_work').doc(id).update({ completed: false, dueAt, leaseUntil: 0, leaseToken: null });
  else await sql('UPDATE notification_work SET completed=false,due_at=$2,lease_until=0 WHERE id=$1', [id, dueAt]);
};

describe('P1 private planning contracts', () => {
  let userId: string, token: string, tripId: string, catalogId: string, outsider: string;
  beforeAll(async () => {
    process.env.TRIP_BUNDLE_VERSIONING = '1';
    await db.initDb(); await seedTiersForTest();
    ({ userId, token } = await registerAndLoginWebUser({ firstName: 'Planning', lastName: 'Owner', email: `p1-owner-${Date.now()}@example.com`, password: 'secret123' }));
    ({ token: outsider } = await registerAndLoginWebUser({ firstName: 'Other', lastName: 'Person', email: `p1-other-${Date.now()}@example.com`, password: 'secret123' }));
    const group = await request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send({ name: 'P1 group' }).expect(201);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`).send({ groupId: group.body.id, name: 'P1 Paris', destination: 'Paris', startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201);
    tripId = trip.body.id;
    catalogId = randomUUID();
    await seedCatalogPlace(catalogId);
    await db.setFeatureFlag('planning_nearby', true, null); await db.setFeatureFlag('trip_bundle', true, null);
    clearFeatureFlagCacheForTesting();
  });
  afterAll(() => { delete process.env.TRIP_BUNDLE_VERSIONING; });
  it('enforces cohorts per caller at both capability and route boundaries; global off wins', async () => {
    const key = 'planning_nearby';
    const setCohort = async (userIds: string[], retireAfter = '2099-01-01T00:00:00.000Z') => {
      await db.setAdminSetting({ key: `feature_cohort:${key}`, value: JSON.stringify({ userIds, owner: 'Planning', retireAfter }), updatedBy: null });
      clearFeatureFlagCacheForTesting();
    };
    await setCohort([userId]);
    expect(await isFeatureEnabled(key, userId)).toBe(true);
    expect(await isFeatureEnabled(key, randomUUID())).toBe(false);
    expect(await isFeatureEnabled(key, userId)).toBe(true);
    expect((await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200)).body.nearby).toBe(true);
    await request(app).get(`/api/activities/nearby?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    await setCohort([]);
    expect((await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200)).body.nearby).toBe(false);
    await request(app).get(`/api/activities/nearby?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(404);
    await setCohort([userId]);
    await db.setFeatureFlag(key, false, null); clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled(key, userId, 'admin')).toBe(false);
    await db.setFeatureFlag(key, true, null);
    await setCohort([userId], '2000-01-01T00:00:00.000Z');
    expect(await isFeatureEnabled(key, userId)).toBe(false);
    await db.setAdminSetting({ key: `feature_cohort:${key}`, value: '{broken', updatedBy: null }); clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled(key, userId)).toBe(false);
    await db.setAdminSetting({ key: `feature_cohort:${key}`, value: 'null', updatedBy: null }); clearFeatureFlagCacheForTesting();
    expect(await isFeatureEnabled(key, userId)).toBe(true);
  });

  it('persists personal digest due time, rechecks its schedule and dedupes parent retries', async () => {
    const base = Date.parse('2026-10-19T00:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(base + 8 * 3600_000);
    const feed = jest.spyOn(db, 'listTripActivity').mockResolvedValue({ events: [{ id: randomUUID(), tripId, actorUserId: randomUUID(), type: 'activity_added', title: 'Changed plan', summary: '', metadata: {}, createdAt: '2026-10-18T12:00:00Z' }], nextCursor: null });
    const parentId = `digest-test-${randomUUID()}`;
    try {
      await db.setFeatureFlag('planning_notifications', true, null); clearFeatureFlagCacheForTesting();
      await notificationRepository().updatePreferences(userId, [{ category: 'trip_digest', inApp: true, push: false, email: false, digestTiming: { timezone: 'America/New_York', time: '08:00' } }]);
      await putNotificationWork({ id: parentId, kind: 'digest', dueAt: base, data: { tripId, ownerId: userId, day: '2026-10-18' } });
      await runPlanningNotifications();
      const child = (await digestChildren()).find(row => row.data.targetUserId === userId && row.data.day === '2026-10-18')!;
      expect(child.due_at).toBe(base + 12 * 3600_000);
      // A preference edit after scheduling moves the same durable work, rather than adding another digest.
      await notificationRepository().updatePreferences(userId, [{ category: 'trip_digest', inApp: true, push: false, email: false, digestTiming: { timezone: 'America/New_York', time: '09:00' } }]);
      now.mockReturnValue(base + 12 * 3600_000); await runPlanningNotifications();
      expect(await workDueAt(child.id)).toBe(base + 13 * 3600_000);
      now.mockReturnValue(base + 13 * 3600_000); await runPlanningNotifications();
      expect(await inboxRowsFor(userId, child.id)).toHaveLength(1);
      await rerunParent(parentId, base);
      await runPlanningNotifications();
      expect(await inboxRowsFor(userId, child.id)).toHaveLength(1);
    } finally { now.mockRestore(); feed.mockRestore(); }
  });

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
    await changeActivityNotes({ id: result.activity.id }, 'A traveler changed this');
    await expect(db.undoCatalogActivity(userId, result.activity.id, 'p1-edited-operation-001')).rejects.toMatchObject({ code: 'ACTIVITY_CHANGED' });
  });
  it('checks access before conditional 304, skips child reads and invalidates direct repository writes', async () => {
    const first = await readPlanningBundle(userId, tripId);
    expect(first.bundle?.trip.id).toBe(tripId);
    const children = jest.spyOn(db, 'listActivities');
    expect((await readPlanningBundle(userId, tripId, undefined, first.etag)).bundle).toBeUndefined();
    expect(children).not.toHaveBeenCalled(); children.mockRestore();
    await request(app).get(`/api/trips/${tripId}/bundle`).set('Authorization', `Bearer ${outsider}`).set('If-None-Match', first.etag).expect(403);
    await changeActivityNotes({ tripId }, 'Ingestion-style direct mutation');
    const changed = await readPlanningBundle(userId, tripId, undefined, first.etag);
    expect(changed.etag).not.toBe(first.etag); expect(changed.bundle).toBeDefined();
  });
  it('preserves lodging coordinates on unrelated edits and clears them on an address change', async () => {
    const lodging = await db.insertLodging({ userId, tripId, status: 'Proposed', name: 'Coordinate hotel', checkInDate: '2027-05-01', checkOutDate: '2027-05-03', rooms: 1, totalCost: 0, costPerNight: 0, address: 'Original address' });
    await setLodgingCoordinates(lodging.id);
    await db.updateLodging(lodging.id, userId, { notes: 'Keep this location' });
    expect(await db.getLodgingById(lodging.id)).toMatchObject({ lat: 48.86, lng: 2.33, coordinateSource: 'manual' });
    await db.updateLodging(lodging.id, userId, { address: 'New address' });
    expect(await db.getLodgingById(lodging.id)).toMatchObject({ lat: null, lng: null, coordinateSource: null });
  });
  it('rejects arbitrary native map proxy inputs without contacting a provider', async () => {
    const upstream = jest.spyOn(globalThis, 'fetch');
    await request(app).get('/api/maps/static?address=private+address').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app).get('/api/maps/trip-day?points=[]').set('Authorization', `Bearer ${token}`).expect(400);
    expect(upstream).not.toHaveBeenCalled(); upstream.mockRestore();
  });
});
