import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { abandonRecapSnapshot, bumpContentRevision, recapSnapshotStates, seedAirports, seedDayCommentCount } from './providerRows';
import { randomUUID } from 'crypto';
import { blogRecapRepository } from '../src/blog/recapRepository';

describe('GET /:tripId/blog/recap', () => {
  const traveler = { firstName: 'Recap', lastName: 'Traveler', email: `blog-recap-traveler-${randomUUID().slice(0, 8)}@example.com`, password: 'Password123!' };
  let token = '';
  let tripId = '';
  let userId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_recap', true, null);
    clearFeatureFlagCacheForTesting();
    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const login = await loginWebUser(traveler);
    token = login.body.token;
    userId = login.body.user.id;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Recap Trip', startDate: '2027-06-01', endDate: '2027-06-03', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    await seedAirports([
      { code: 'QXA', name: 'Recap A', city: 'A', country: 'Test', lat: 0, lng: 0 },
      { code: 'QXB', name: 'Recap B', city: 'B', country: 'Test', lat: 0, lng: 1 },
    ]);
    await request(app).post('/api/transfers').set('Authorization', `Bearer ${token}`).send({
      tripId, passengerIds: [userId], passengerName: 'Recap Traveler', departureDate: '2027-06-01', departureLocation: 'QXA', departureAirportCode: 'QXA',
      departureTime: '09:00', arrivalLocation: 'QXB', arrivalAirportCode: 'QXB', arrivalTime: '10:00', cost: 0, carrier: 'Test Air', flightNumber: 'TA1', bookingReference: 'R1', status: 'Completed',
    }).expect(201);
    await seedDayCommentCount(tripId, '2027-06-02', 'travelers', 4);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email]); });

  it('queues one durable build and returns the stable revision snapshot', async () => {
    const first = await request(app).get(`/api/trips/${tripId}/blog/recap`).set('Authorization', `Bearer ${token}`);
    if (first.status !== 202) throw new Error(`Expected recap build to queue, got ${first.status}: ${JSON.stringify(first.body)}`);
    expect(first.body).toEqual(expect.objectContaining({ state: 'pending' }));

    let ready: request.Response | null = null;
    for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const response = await request(app).get(`/api/trips/${tripId}/blog/recap`).set('Authorization', `Bearer ${token}`);
      if (response.status === 200) ready = response;
    }
    if (!ready) {
      throw new Error(`Recap did not become ready: ${JSON.stringify(await recapSnapshotStates(tripId))}`);
    }
    expect(ready.body.state).toBe('ready');
    expect(ready?.body.recap).toEqual(expect.objectContaining({ title: 'Recap Trip', dayCount: 3, startDate: '2027-06-01', endDate: '2027-06-03', distanceKm: 111, audienceClass: 'travelers', mostCommentedDay: { dayDate: '2027-06-02', commentCount: 4 } }));
    expect(ready?.body.recap.topPhoto).toBeNull();

    const cached = await request(app).get(`/api/trips/${tripId}/blog/recap`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(cached.body.recap.generatedAt).toBe(ready?.body.recap.generatedAt);
  });

  it('is hidden when its major-component flag is disabled', async () => {
    await setFeatureFlag('trip_blog_recap', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).get(`/api/trips/${tripId}/blog/recap`).set('Authorization', `Bearer ${token}`).expect(404);
    await setFeatureFlag('trip_blog_recap', true, null);
    clearFeatureFlagCacheForTesting();
  });

  it('allows only one lease owner and recovers an expired claim', async () => {
    await bumpContentRevision(tripId);
    const revision = await blogRecapRepository().getRecapRevision(tripId);
    expect(revision).not.toBeNull();
    const firstClaims = await Promise.all([
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-a', 60),
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-b', 60),
    ]);
    expect(firstClaims.filter(Boolean)).toHaveLength(1);

    await abandonRecapSnapshot(tripId, revision!.contentRevision);
    const recoveryClaims = await Promise.all([
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-c', 60),
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-d', 60),
    ]);
    expect(recoveryClaims.filter(Boolean)).toHaveLength(1);
  });
});
