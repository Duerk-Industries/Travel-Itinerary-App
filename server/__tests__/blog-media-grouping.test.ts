import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (A2) — architecture §5.3:
// POST /blog/media/group is stateless, pure computation over the trip's own day range.
describe('POST /:tripId/blog/media/group', () => {
  const traveler = { firstName: 'Group', lastName: 'Traveler', email: 'blog-media-group-traveler@example.com', password: 'Password123!' };
  let travelerToken = '';
  let tripId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_authoring_assist', true, null);
    await setFeatureFlag('trip_blog_photo_composer', true, null);

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    travelerToken = (await loginWebUser(traveler)).body.token;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Grouping Trip', startDate: '2027-05-01', endDate: '2027-05-03', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email]); });

  it('buckets in-range candidates by day, sorted', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({
        candidates: [
          { clientId: 'c1', capturedAt: '2027-05-02T10:00:00.000Z' },
          { clientId: 'c2', capturedAt: '2027-05-01T08:00:00.000Z' },
          { clientId: 'c3', capturedAt: '2027-05-01T20:00:00.000Z' },
        ],
      })
      .expect(200);
    expect(res.body.buckets).toEqual([
      { dayDate: '2027-05-01', clientIds: ['c2', 'c3'] },
      { dayDate: '2027-05-02', clientIds: ['c1'] },
    ]);
    expect(res.body.unassigned).toEqual([]);
    expect(res.body.outOfRange).toEqual([]);
  });

  it('a candidate with no capturedAt lands in unassigned, never auto-assigned (FR-A2.2)', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ candidates: [{ clientId: 'no-date' }, { clientId: 'blank-date', capturedAt: '' }] })
      .expect(200);
    expect(res.body.buckets).toEqual([]);
    expect(res.body.unassigned.sort()).toEqual(['blank-date', 'no-date']);
  });

  it('a candidate outside the trip range is flagged out-of-range, not silently dropped or clamped', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ candidates: [{ clientId: 'too-early', capturedAt: '2027-04-20T10:00:00.000Z' }] })
      .expect(200);
    expect(res.body.buckets).toEqual([]);
    expect(res.body.outOfRange).toEqual([{ clientId: 'too-early', capturedAt: '2027-04-20T10:00:00.000Z' }]);
  });

  it('rejects more than 500 candidates', async () => {
    const candidates = Array.from({ length: 501 }, (_, i) => ({ clientId: `c${i}`, capturedAt: '2027-05-01T10:00:00.000Z' }));
    await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ candidates })
      .expect(400);
  });

  it('never writes anything — the same request run twice returns identical buckets', async () => {
    const body = { candidates: [{ clientId: 'stable', capturedAt: '2027-05-01T10:00:00.000Z' }] };
    const first = await request(app).post(`/api/trips/${tripId}/blog/media/group`).set('Authorization', `Bearer ${travelerToken}`).send(body).expect(200);
    const second = await request(app).post(`/api/trips/${tripId}/blog/media/group`).set('Authorization', `Bearer ${travelerToken}`).send(body).expect(200);
    expect(first.body).toEqual(second.body);
  });

  it('a stranger with no relationship to the trip gets 403', async () => {
    const stranger = { firstName: 'Group', lastName: 'Stranger', email: 'blog-media-group-stranger@example.com', password: 'Password123!' };
    await registerWebUser(stranger);
    await confirmWebUser(stranger.email);
    const strangerToken = (await loginWebUser(stranger)).body.token;
    await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ candidates: [{ clientId: 'c1', capturedAt: '2027-05-01T10:00:00.000Z' }] })
      .expect(403);
    await cleanupTestUsersByEmail([stranger.email]);
  });

  it('the blog capabilities endpoint reports trip_blog_photo_composer so the client shows the composer entry', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog/capabilities`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.features.trip_blog_photo_composer).toBe(true);
  });

  it('404s when the flag is off', async () => {
    await setFeatureFlag('trip_blog_photo_composer', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app)
      .post(`/api/trips/${tripId}/blog/media/group`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ candidates: [] })
      .expect(404);
    await setFeatureFlag('trip_blog_photo_composer', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
