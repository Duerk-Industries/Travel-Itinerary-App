import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { queryBlog } from '../src/db.postgres';
import { randomUUID } from 'crypto';
import { blogRecapRepository } from '../src/blog/recapRepository';

describe('GET /:tripId/blog/recap', () => {
  const traveler = { firstName: 'Recap', lastName: 'Traveler', email: 'blog-recap-traveler@example.com', password: 'Password123!' };
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
    await queryBlog("INSERT INTO airports (iata_code, name, city, country, lat, lng) VALUES ('QXA', 'Recap A', 'A', 'Test', 0, 0), ('QXB', 'Recap B', 'B', 'Test', 0, 1)");
    await queryBlog(
      `INSERT INTO flights (id, user_id, trip_id, status, transfer_type, passenger_name, departure_date,
        departure_airport_code, departure_time, arrival_airport_code, arrival_time, cost, carrier, flight_number, booking_reference)
       VALUES ($1, $2, $3, 'Completed', 'Flight', 'Recap Traveler', '2027-06-01', 'QXA', '09:00', 'QXB', '10:00', 0, 'Test Air', 'TA1', 'R1')`,
      [randomUUID(), userId, tripId]
    );
    const day = await queryBlog<{ id: string }>("SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = '2027-06-02'", [tripId]);
    await queryBlog(
      `INSERT INTO blog_engagement_counters (target_kind, target_id, trip_id, audience, reaction_counts, reaction_total, comment_count)
       VALUES ('day', $1, $2, 'travelers', '{}'::jsonb, 0, 4)`,
      [day.rows[0].id, tripId]
    );
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
      const snapshots = await queryBlog('SELECT state, failure_code FROM blog_recap_snapshots WHERE trip_id = $1', [tripId]);
      throw new Error(`Recap did not become ready: ${JSON.stringify(snapshots.rows)}`);
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
    await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1 WHERE trip_id = $1', [tripId]);
    const revision = await blogRecapRepository().getRecapRevision(tripId);
    expect(revision).not.toBeNull();
    const firstClaims = await Promise.all([
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-a', 60),
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-b', 60),
    ]);
    expect(firstClaims.filter(Boolean)).toHaveLength(1);

    await queryBlog(
      "UPDATE blog_recap_snapshots SET state = 'pending', lease_expires_at = '2000-01-01', lease_owner = 'dead-worker' WHERE trip_id = $1 AND content_revision = $2",
      [tripId, revision!.contentRevision]
    );
    const recoveryClaims = await Promise.all([
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-c', 60),
      blogRecapRepository().claimRecapSnapshot(revision!, 'travelers', 'worker-d', 60),
    ]);
    expect(recoveryClaims.filter(Boolean)).toHaveLength(1);
  });
});
