import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { blogItemExists } from './providerRows';
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
    await request(app).post('/api/activities').set(auth())
      .send({ tripId, date: '2027-04-02', name: 'Market walk', startLocation: 'Pike Place Market', startTime: '09:00', duration: '2 hours', cost: '0', status: 'Completed' }).expect(201);
  });
  afterAll(async () => { await cleanupTestUsersByEmail([user.email]); });

  it('makes queued text replay idempotent and searchable without returning raw HTML', async () => {
    const endpoint = `/api/trips/${tripId}/blog/items`;
    const first = await request(app).post(endpoint).set(auth()).set('Idempotency-Key', 'offline-entry-1').send({ kindKey: 'core.text', dayDate: '2027-04-02', body: '<p>Rainy market morning</p>' });
    if (first.status !== 201) throw new Error(`create failed ${first.status}: ${JSON.stringify(first.body)}`);
    const replay = await request(app).post(endpoint).set(auth()).set('Idempotency-Key', 'offline-entry-1').send({ kindKey: 'core.text', dayDate: '2027-04-02', body: '<p>different retry body</p>' }).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await blogItemExists(first.body.id)).toBe(1);
    const search = await request(app).get(`/api/trips/${tripId}/blog/search?q=market`).set(auth());
    if (search.status !== 200) throw new Error(`search failed ${search.status}: ${JSON.stringify(search.body)}`);
    expect(search.body.results[0]).toEqual(expect.objectContaining({ id: first.body.id, localDate: '2027-04-02', snippet: 'Rainy market morning' }));
  });

  it('derives a bounded maps-ready places index without a geocoding call', async () => {
    const response = await request(app).get(`/api/trips/${tripId}/blog/places`).set(auth()).expect(200);
    expect(response.body.places).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Pike Place Market', firstDate: '2027-04-02', sourceTypes: ['activities'] })]));
  });

  it('does not create a voice note when object storage is unavailable', async () => {
    // Simulate the outage explicitly: whether real signing works depends on the machine's credentials.
    const signing = jest.spyOn(require('../src/services/blogStorageClient') as typeof import('../src/services/blogStorageClient'), 'createBlogUploadUrl').mockResolvedValue(null);
    try {
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth()).set('Idempotency-Key', 'voice-1')
      .send({ dayDate: '2027-04-02', mediaKind: 'audio', mimeType: 'audio/m4a', byteSize: 1024, tags: ['voice-memory-unique'] }).expect(503);
    expect(init.body.error).toMatch(/storage is unavailable/i);
    await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth()).set('Idempotency-Key', 'voice-too-large')
      .send({ dayDate: '2027-04-02', mediaKind: 'audio', mimeType: 'audio/m4a', byteSize: 26214401 }).expect(400);
    await request(app).post(`/api/trips/${tripId}/blog/modalities`).set(auth()).send({ dayDate: '2027-04-02', kindKey: 'media.audio', payload: {} }).expect(409);
    } finally { signing.mockRestore(); }
  });
});
