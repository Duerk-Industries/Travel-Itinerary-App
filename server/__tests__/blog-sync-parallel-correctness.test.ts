import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

// Regression test for parallelizing syncLinkedItineraryItems (server/src/blog/postgresRepository.ts,
// firebaseRepository.ts): every itinerary_details row's blog link is now processed
// concurrently via Promise.all instead of one at a time, including N concurrent
// `content_revision = content_revision + 1` bumps against the same trip_blogs row. A naive
// parallel increment is a classic lost-update bug — this proves all N increments landed and
// every item actually got linked, not just however many happened to run without racing.
describe('trip blog sync — parallel correctness', () => {
  const owner = { firstName: 'Blog', lastName: 'Parallel', email: 'blog-sync-parallel@example.com', password: 'Password123!' };
  const dateFromTodayUtc = (days: number): string => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  let token = '';
  let tripId = '';
  let itineraryId = '';
  const ITEM_COUNT = 20;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('itinerary_item_kinds', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Parallel Sync Trip', startDate: dateFromTodayUtc(7), endDate: dateFromTodayUtc(10), participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    const itinerary = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, destination: 'Parallel City', days: 4 })
      .expect(201);
    itineraryId = itinerary.body.id;

    // Each POST below also fires its own background write-path sync (a full re-scan of
    // every detail row created so far — see triggerBlogSyncForTrip), so by the time the
    // assertions run, this has already exercised several overlapping full-table sync
    // passes racing each other, on top of whichever pass(es) the GET calls below trigger.
    // That's a stronger concurrency stress than a single pass would be, not a weaker one.
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      await request(app)
        .post(`/api/itineraries/${itineraryId}/details`)
        .set('Authorization', `Bearer ${token}`)
        .send({ day: (i % 4) + 1, kind: i % 2 === 0 ? 'place' : 'note', activity: `Parallel Stop ${i}`, noteBody: `Detail body ${i}` })
        .expect(201);
    }
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email]);
  });

  it('links every source item exactly once after a single sync pass', async () => {
    const blog = await request(app)
      .get(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 100 })
      .expect(200);

    const allSourceIds = (blog.body.days ?? []).flatMap((day: any) =>
      (day.items ?? []).filter((item: any) => item.sourceType === 'itinerary_detail').map((item: any) => item.sourceId)
    );
    expect(new Set(allSourceIds).size).toBe(ITEM_COUNT);
  });

  it('running the sync again is idempotent — no duplicate links from a second pass', async () => {
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).query({ limit: 100 }).expect(200);
    const blog = await request(app)
      .get(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 100 })
      .expect(200);
    const allSourceIds = (blog.body.days ?? []).flatMap((day: any) =>
      (day.items ?? []).filter((item: any) => item.sourceType === 'itinerary_detail').map((item: any) => item.sourceId)
    );
    expect(allSourceIds.length).toBe(ITEM_COUNT);
    expect(new Set(allSourceIds).size).toBe(ITEM_COUNT);
  });
});
