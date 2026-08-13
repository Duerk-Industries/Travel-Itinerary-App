import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { markSynced, shouldSkipSync } from '../src/blog/syncCoordination';

// End-to-end regression test for the write-path sync trigger (itineraryDataRoutes.ts ->
// triggerBlogSyncForTrip): a new itinerary detail should show up in the blog without the
// caller needing an extra "refresh" round-trip beyond the GET they'd naturally make to
// view it. The read path is forced into debounce-skip mode right before the mutation —
// triggerBlogSyncForTrip's synchronous invalidateSync() call (unit-tested in isolation in
// blog-trigger-sync.test.ts) is what clears that, which is itself part of the behavior
// under test here: if the write-path trigger silently stopped invalidating the debounce,
// this test would see the read path *stay* skipped and time out never finding the item,
// exactly the stale-read bug that guard exists to prevent.
const waitUntil = async (predicate: () => Promise<boolean>, timeoutMs = 2000, intervalMs = 20): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
};

describe('trip blog write-path sync', () => {
  const owner = { firstName: 'Blog', lastName: 'Writer', email: 'blog-write-path-sync@example.com', password: 'Password123!' };
  const dateFromTodayUtc = (days: number): string => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const tripStartDate = dateFromTodayUtc(7);
  const tripEndDate = dateFromTodayUtc(8);
  let token = '';
  let tripId = '';
  let itineraryId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('itinerary_item_kinds', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Write Path Sync Trip', startDate: tripStartDate, endDate: tripEndDate, participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    const itinerary = await request(app).post('/api/itineraries').set('Authorization', `Bearer ${token}`).send({ tripId, destination: 'Write Path City', days: 2 }).expect(201);
    itineraryId = itinerary.body.id;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email]);
  });

  it('reflects a new itinerary detail without the read path having to sync it', async () => {
    // Prime GET /blog once so trip_blogs/blog_days exist, then force the read path to skip.
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    markSynced(tripId);
    expect(shouldSkipSync(tripId)).toBe(true);

    const detail = await request(app)
      .post(`/api/itineraries/${itineraryId}/details`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 1, kind: 'place', activity: 'Write Path Landmark', noteBody: 'Reachable by tram.' })
      .expect(201);

    await waitUntil(async () => {
      // shouldSkipSync would have been re-poisoned to true again if the read path had
      // run its own sync in between — it should stay false, since only the write-path
      // trigger's invalidateSync ran, and nothing has re-marked it synced yet.
      const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).query({ limit: 100 });
      const found = (blog.body.days ?? []).some((day: any) =>
        (day.items ?? []).some((item: any) => item.sourceId === detail.body.id)
      );
      return found;
    });
  });
});
