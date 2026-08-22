import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { clearDayFactsCacheForTests } from '../src/services/blogDayFactsService';

// Phase 5 of docs/trip-blog-social-implementation-plan.md — "what actually happened" (C1, C2, C3,
// C5). Facts omit undeliverable rows entirely rather than emitting zeros, and are filtered before
// derivation so a follower never receives an itinerary-derived fact.
describe('GET /:tripId/blog/days/:dayDate/facts', () => {
  const traveler = { firstName: 'Facts', lastName: 'Traveler', email: 'blog-day-facts-traveler@example.com', password: 'Password123!' };
  const follower = { firstName: 'Facts', lastName: 'Follower', email: 'blog-day-facts-follower@example.com', password: 'Password123!' };

  let travelerToken = '';
  let followerToken = '';
  let tripId = '';
  const dayDate = '2027-03-05';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_day_facts', true, null);

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    travelerToken = (await loginWebUser(traveler)).body.token;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const followerLogin = await loginWebUser(follower);
    followerToken = followerLogin.body.token;
    const followerId = followerLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Facts Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);

    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ tripId, date: dayDate, name: 'Colosseum Tour', startLocation: 'Colosseum, Rome', startTime: '09:00', duration: '2h', cost: '50', status: 'Completed' })
      .expect(201);
    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ tripId, date: dayDate, name: 'Cancelled Cooking Class', startLocation: 'Trastevere, Rome', startTime: '18:00', duration: '3h', cost: '80', status: 'Cancelled' })
      .expect(201);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email, follower.email]); });

  beforeEach(() => { clearDayFactsCacheForTests(); });

  it('requires dayDate to be YYYY-MM-DD', async () => {
    await request(app).get(`/api/trips/${tripId}/blog/days/not-a-date/facts`).set('Authorization', `Bearer ${travelerToken}`).expect(400);
  });

  it('404s for a day outside the trip range', async () => {
    await request(app).get(`/api/trips/${tripId}/blog/days/2099-01-01/facts`).set('Authorization', `Bearer ${travelerToken}`).expect(404);
  });

  it('a stranger with no relationship to the trip gets 403', async () => {
    const stranger = { firstName: 'Facts', lastName: 'Stranger', email: 'blog-day-facts-stranger@example.com', password: 'Password123!' };
    await registerWebUser(stranger);
    await confirmWebUser(stranger.email);
    const strangerToken = (await loginWebUser(stranger)).body.token;
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${strangerToken}`).expect(403);
    await cleanupTestUsersByEmail([stranger.email]);
  });

  it('a traveler sees planned-vs-actual and places facts, plus a full itinerary timeline', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.dayDate).toBe(dayDate);

    const plannedVsActual = res.body.facts.find((f: any) => f.key === 'plannedVsActual');
    expect(plannedVsActual).toBeTruthy();
    expect(plannedVsActual.value).toContain('1 completed');
    expect(plannedVsActual.value).toContain('1 cancelled');
    expect(plannedVsActual.confidence).toBe('high');
    expect(plannedVsActual.sourceTypes).toEqual(['tours']);

    const places = res.body.facts.find((f: any) => f.key === 'places');
    expect(places).toBeTruthy();
    expect(places.value).toContain('Colosseum, Rome');
    expect(places.value).toContain('Trastevere, Rome');

    const activityEntries = res.body.timeline.filter((t: any) => t.kind === 'activity');
    expect(activityEntries).toHaveLength(2);
    // Sorted by time.
    expect(activityEntries[0].label).toBe('Colosseum Tour');
    expect(activityEntries[1].label).toBe('Cancelled Cooking Class');
  });

  it('a follower never receives itinerary-derived facts or timeline entries at all', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${followerToken}`).expect(200);
    expect(res.body.facts.find((f: any) => f.key === 'plannedVsActual')).toBeUndefined();
    expect(res.body.facts.find((f: any) => f.key === 'places')).toBeUndefined();
    expect(res.body.timeline.find((t: any) => t.kind === 'activity')).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Colosseum');
    expect(JSON.stringify(res.body)).not.toContain('Trastevere');
  });

  it('omits distance/media facts entirely rather than emitting zeros when there are no photos', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.facts.find((f: any) => f.key === 'media')).toBeUndefined();
    expect(res.body.facts.find((f: any) => f.key === 'distance')).toBeUndefined();
  });

  it('404s when the flag is off', async () => {
    await setFeatureFlag('trip_blog_day_facts', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${travelerToken}`).expect(404);
    await setFeatureFlag('trip_blog_day_facts', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
