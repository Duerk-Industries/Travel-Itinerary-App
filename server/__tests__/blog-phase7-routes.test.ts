import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('Phase 7 blog discovery and offline replay routes', () => {
  const user = { firstName: 'Phase', lastName: 'Seven', email: 'blog-phase7@example.com', password: 'Password123!' };
  let token = '';
  let userId = '';
  let tripId = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await initDb();
    for (const flag of ['trip_blog', 'trip_blog_search', 'trip_blog_places', 'trip_blog_audio']) await setFeatureFlag(flag, true, null);
    clearFeatureFlagCacheForTesting();
    await registerWebUser(user); await confirmWebUser(user.email);
    const login = await loginWebUser(user); token = login.body.token; userId = login.body.user.id;
    const trip = await request(app).post('/api/trips/wizard').set(auth()).send({ name: 'Phase 7 Trip', startDate: '2027-04-01', endDate: '2027-04-03', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set(auth()).expect(200);
    await queryBlog(
      `INSERT INTO tours (id, user_id, trip_id, status, activity_type, date, name, start_location, start_time, duration, cost, booked_on, reference)
       VALUES ($1, $2, $3, 'Completed', 'Tour', '2027-04-02', 'Market walk', 'Pike Place Market', '09:00', '2 hours', 0, '2027-03-01', 'P7')`,
      [randomUUID(), userId, tripId]
    );
  });
  afterAll(async () => { await cleanupTestUsersByEmail([user.email]); });

  it('makes queued text replay idempotent and searchable without returning raw HTML', async () => {
    const endpoint = `/api/trips/${tripId}/blog/items`;
    const first = await request(app).post(endpoint).set(auth()).set('Idempotency-Key', 'offline-entry-1').send({ kindKey: 'core.text', dayDate: '2027-04-02', body: '<p>Rainy market morning</p>' });
    if (first.status !== 201) throw new Error(`create failed ${first.status}: ${JSON.stringify(first.body)}`);
    const replay = await request(app).post(endpoint).set(auth()).set('Idempotency-Key', 'offline-entry-1').send({ kindKey: 'core.text', dayDate: '2027-04-02', body: '<p>different retry body</p>' }).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    const count = await queryBlog<{ count: string }>('SELECT COUNT(*)::int AS count FROM blog_items WHERE id = $1', [first.body.id]);
    expect(Number(count.rows[0].count)).toBe(1);
    const search = await request(app).get(`/api/trips/${tripId}/blog/search?q=market`).set(auth());
    if (search.status !== 200) throw new Error(`search failed ${search.status}: ${JSON.stringify(search.body)}`);
    expect(search.body.results[0]).toEqual(expect.objectContaining({ id: first.body.id, localDate: '2027-04-02', snippet: 'Rainy market morning' }));
  });

  it('derives a bounded maps-ready places index without a geocoding call', async () => {
    const response = await request(app).get(`/api/trips/${tripId}/blog/places`).set(auth()).expect(200);
    expect(response.body.places).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Pike Place Market', firstDate: '2027-04-02', sourceTypes: ['activities'] })]));
  });

  it('routes voice notes through capped uploader storage instead of the fake modality job', async () => {
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth()).set('Idempotency-Key', 'voice-1')
      .send({ dayDate: '2027-04-02', mediaKind: 'audio', mimeType: 'audio/m4a', byteSize: 1024 }).expect(201);
    expect(init.body.asset.mediaKind).toBe('audio');
    await request(app).post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`).set(auth()).send({ physicalBytes: 1024 }).expect(200);
    await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth()).set('Idempotency-Key', 'voice-too-large')
      .send({ dayDate: '2027-04-02', mediaKind: 'audio', mimeType: 'audio/m4a', byteSize: 26214401 }).expect(400);
    await request(app).post(`/api/trips/${tripId}/blog/modalities`).set(auth()).send({ dayDate: '2027-04-02', kindKey: 'media.audio', payload: {} }).expect(409);
  });
});
