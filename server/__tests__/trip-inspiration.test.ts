import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { insertPublicAlias, insertPublicEpoch, revokeEpochs, setStoredVisibility } from './providerRows';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

/** Provider-neutral HTTP contracts: also run with server's test:firestore runner. */
describe('Trips like this and credited activity copies', () => {
  const suffix = randomUUID().slice(0, 8), day = '2027-05-02';
  let owner = '', ownerId = '', visitor = '', outsider = '', sourceTrip = '', targetTrip = '', otherDestination = '', activityId = '';
  const username = `inspire-${suffix}`, slug = 'paris';
  const auth = (token = visitor) => ({ Authorization: `Bearer ${token}` });
  const browse = (tripId = targetTrip, token = visitor) => request(app).get(`/api/trips/${tripId}/similar-trips`).set(auth(token));
  const sharing = (enabled: boolean, token = owner) => request(app).put(`/api/trips/${sourceTrip}/activity-sharing`).set(auth(token)).send({ enabled });
  const copy = (key = randomUUID(), overrides: Record<string, unknown> = {}, token = visitor) => request(app).post('/api/activities').set(auth(token)).set('Idempotency-Key', key)
    .send({ tripId: targetTrip, date: day, publicSource: { username, tripSlug: slug, activityId }, ...overrides });
  const sql = async (text: string, params: unknown[]) => (await import('../src/db.postgres')).queryBlog(text, params);
  const firestore = async () => (await import('../src/db.firebase')).getDb();
  const trip = async (token: string, destination: string) => {
    const group = await request(app).post('/api/groups').set(auth(token)).send({ name: `Group ${randomUUID()}` }).expect(201);
    return (await request(app).post('/api/trips').set(auth(token)).send({ groupId: group.body.id, name: `${destination} trip`, locationIds: [destination.trim().toLowerCase()], startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201)).body.id as string;
  };
  beforeAll(async () => {
    await db.initDb(); await seedTiersForTest();
    ({ token: owner, userId: ownerId } = await registerAndLoginWebUser({ firstName: 'Source', lastName: 'Author', email: `inspiration-owner-${suffix}@example.com`, password: 'secret123' }));
    ({ token: visitor } = await registerAndLoginWebUser({ firstName: 'Visitor', lastName: 'Traveler', email: `inspiration-visitor-${suffix}@example.com`, password: 'secret123' }));
    ({ token: outsider } = await registerAndLoginWebUser({ firstName: 'Other', lastName: 'Traveler', email: `inspiration-other-${suffix}@example.com`, password: 'secret123' }));
    for (const key of ['trip_blog', 'planning_nearby', 'planning_trip_inspiration']) await db.setFeatureFlag(key, true, null);
    clearFeatureFlagCacheForTesting();
    sourceTrip = await trip(owner, 'Paris'); targetTrip = await trip(visitor, ' Paris '); otherDestination = await trip(visitor, 'Tokyo');
    await request(app).get(`/api/trips/${sourceTrip}/blog`).set(auth(owner)).expect(200);
    await request(app).patch(`/api/trips/${sourceTrip}/blog`).set(auth(owner)).send({ title: 'Shared Paris ideas' }).expect(200);
    await setStoredVisibility(sourceTrip, 'public'); await insertPublicEpoch(sourceTrip, ownerId, 42);
    await insertPublicAlias(sourceTrip, ownerId, username, slug);
    if (db.getCurrentDbProvider() === 'firebase') await (await firestore()).collection('trip_blogs').doc(sourceTrip).update({ visibilityEpoch: 42, indexingEnabled: true });
    else await sql('UPDATE trip_blogs SET visibility_epoch=42,indexing_enabled=TRUE WHERE trip_id=$1', [sourceTrip]);
    const catalogId = randomUUID();
    const payload = { destinationKey: 'paris', destinationDisplayName: 'Paris', activityType: 'Sights & Landmarks', lat: 48.86, lon: 2.33, sourceUrl: 'https://en.wikipedia.org/wiki/Paris', sourceLabel: 'Wikipedia' };
    if (db.getCurrentDbProvider() === 'firebase') await (await firestore()).collection('locations').doc(catalogId).set({ name: 'Public Garden', sourceType: 'attraction', category: 'attraction', searchName: 'public garden paris', payload });
    else await sql("INSERT INTO locations(id,name,source_type,category,search_name,payload) VALUES($1,'Public Garden','attraction','attraction','public garden paris',$2)", [catalogId, JSON.stringify(payload)]);
    activityId = (await request(app).post('/api/activities').set(auth(owner)).set('Idempotency-Key', randomUUID()).send({ tripId: sourceTrip, date: day, catalogId }).expect(201)).body.id;
    await db.updateActivity(activityId, ownerId, { name: 'Private traveler name', notes: 'Secret notes', reference: 'SECRET-BOOKING', startLocation: 'Private lodging address', cost: 777 });
    await request(app).post('/api/activities').set(auth(owner)).send({ tripId: sourceTrip, date: day, name: 'Private manual activity', startLocation: 'Hidden address', duration: '1h', cost: 50 }).expect(201);
  });

  it('requires explicit sharing and previews only catalog allowlisted fields', async () => {
    expect((await browse().expect(200)).body.trips).toEqual([]);
    const preview = await request(app).get(`/api/trips/${sourceTrip}/activity-sharing`).set(auth(owner)).expect(200);
    expect(preview.body.enabled).toBe(false);
    expect(preview.body.activities).toHaveLength(1);
    expect(preview.body.activities[0]).toMatchObject({ id: activityId, name: 'Public Garden', lat: 48.86, lng: 2.33 });
    expect(JSON.stringify(preview.body)).not.toMatch(/Secret|SECRET|Private|777|Hidden/);
    await copy().expect(409);
    await sharing(true).expect(200);
  });
  it('recommends only the same destination and returns no private source data', async () => {
    const response = await browse().expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.trips).toHaveLength(1);
    expect(response.body.trips[0]).toMatchObject({ username, tripSlug: slug, title: 'Shared Paris ideas', sourcePath: `/${username}/${slug}` });
    expect(JSON.stringify(response.body)).not.toMatch(/Secret|SECRET|Private|777|Hidden|userId|paidBy|travelerIds|reference|notes/);
    expect((await browse(otherDestination).expect(200)).body.trips).toEqual([]);
    expect((await browse(sourceTrip, owner).expect(200)).body.trips).toEqual([]);
  });
  it('copies a proposed template with source credit and atomically replays the same operation', async () => {
    const key = randomUUID();
    const first = await copy(key).expect(201);
    expect(first.body).toMatchObject({ tripId: targetTrip, date: day, name: 'Public Garden', status: 'Proposed', cost: 0, reference: '', paidBy: [], travelerIds: [], lat: 48.86, lng: 2.33 });
    expect(first.body.notes).toBe(`Inspired by Shared Paris ideas\n/${username}/${slug}\nCatalog source: https://en.wikipedia.org/wiki/Paris`);
    const replay = await copy(key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true'); expect(replay.body.id).toBe(first.body.id);
    await copy(key, { date: '2027-05-03' }).expect(409);
    await copy().expect(409); // a new key cannot add the same catalog idea twice to one day
    await request(app).delete(`/api/activities/${first.body.id}`).set(auth()).set('Idempotency-Key', key).expect(204);
    await copy(key).expect(409); // an undone operation cannot silently resurrect the row
  });
  it('checks membership, input allowlisting, dates and capability gates', async () => {
    await browse(targetTrip, outsider).expect(403); await copy(randomUUID(), {}, outsider).expect(403);
    await sharing(false, visitor).expect(403);
    await copy(randomUUID(), { date: '2027-05-99' }).expect(400);
    await copy(randomUUID(), { date: '2027-06-01' }).expect(422);
    await copy(randomUUID(), { notes: 'Injected', lat: 1 }).expect(400);
    await db.setFeatureFlag('planning_trip_inspiration', false, null); clearFeatureFlagCacheForTesting();
    await browse().expect(404); await copy().expect(404);
    expect((await request(app).get(`/api/trips/${targetTrip}/planning-capabilities`).set(auth()).expect(200)).body.inspiration).toBe(false);
    await db.setFeatureFlag('planning_trip_inspiration', true, null); clearFeatureFlagCacheForTesting();
  });
  it('withdraws immediately on sharing opt-out, unpublish, or revoked publication consent', async () => {
    const key = randomUUID();
    const existing = await copy(key, { date: '2027-05-03' }).expect(201);
    await sharing(false).expect(200); expect((await browse().expect(200)).body.trips).toEqual([]); await copy().expect(409);
    await copy(key, { date: '2027-05-03' }).expect(409); // source consent is rechecked even before replay
    expect((await request(app).get(`/api/activities?tripId=${targetTrip}`).set(auth()).expect(200)).body.some((item: { id: string }) => item.id === existing.body.id)).toBe(true);
    await sharing(true).expect(200); await setStoredVisibility(sourceTrip, 'private');
    expect((await browse().expect(200)).body.trips).toEqual([]); await copy().expect(409);
    await setStoredVisibility(sourceTrip, 'public');
    if (db.getCurrentDbProvider() === 'firebase') await (await firestore()).collection('trip_blogs').doc(sourceTrip).update({ indexingEnabled: false });
    else await sql('UPDATE trip_blogs SET indexing_enabled=FALSE WHERE trip_id=$1', [sourceTrip]);
    expect((await browse().expect(200)).body.trips).toEqual([]); await copy().expect(409);
    if (db.getCurrentDbProvider() === 'firebase') await (await firestore()).collection('trip_blogs').doc(sourceTrip).update({ indexingEnabled: true });
    else await sql('UPDATE trip_blogs SET indexing_enabled=TRUE WHERE trip_id=$1', [sourceTrip]);
    await revokeEpochs(sourceTrip);
    expect((await browse().expect(200)).body.trips).toEqual([]); await copy().expect(409);
  });
});
