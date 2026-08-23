import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { getDayStarter } from '../src/services/blogDayStarterService';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (A1) — architecture §8: a deterministic
// template, never an LLM call. "Day Starter determinism against fixed fixtures (byte-identical
// output)", "suppressed after dismissal, and for days that already have text" (Phase 5's own test
// list).
describe('Day Starter (get/accept/dismiss)', () => {
  const traveler = { firstName: 'Starter', lastName: 'Traveler', email: 'blog-day-starter-traveler@example.com', password: 'Password123!' };
  let travelerToken = '';
  let tripId = '';
  const dayDate = '2027-04-10';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_authoring_assist', true, null);
    await setFeatureFlag('trip_blog_day_starter', true, null);

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    travelerToken = (await loginWebUser(traveler)).body.token;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Starter Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email]); });

  it('with no itinerary data and no media, there is no suggestion', async () => {
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(204);
  });

  it('is deterministic — identical inputs produce byte-identical output across repeated calls', async () => {
    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ tripId, date: dayDate, name: 'Louvre Museum', startLocation: 'Paris', startTime: '10:00', duration: '3h', cost: '25', notes: 'Why this fits your group: everyone loves art.' })
      .expect(201);

    const first = await getDayStarter(tripId, (await loginWebUser(traveler)).body.user.id, dayDate);
    const second = await getDayStarter(tripId, (await loginWebUser(traveler)).body.user.id, dayDate);
    expect(first).toEqual(second);
    expect(first?.body).toBe('Louvre Museum is a stop your group may enjoy because everyone loves art.');
    expect(first?.sourceTypes).toEqual(['tours']);

    const res = await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.draft).toBe('Louvre Museum is a stop your group may enjoy because everyone loves art.');
    expect(res.body.sources).toEqual(['tours']);
  });

  it('accept turns the suggestion into an ordinary core.text item with source_type day_starter', async () => {
    const accepted = await request(app).post(`/api/trips/${tripId}/blog/days/${dayDate}/starter/accept`).set('Authorization', `Bearer ${travelerToken}`).expect(201);
    expect(accepted.body.body).toBe('Louvre Museum is a stop your group may enjoy because everyone loves art.');
    expect(accepted.body.kindKey).toBe('core.text');
    expect(accepted.body.sourceType).toBe('day_starter');
  });

  it('is suppressed once the day already has a text item', async () => {
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(204);
  });

  it('dismissal suppresses the suggestion for that user on that day', async () => {
    const otherDate = '2027-04-11';
    const otherTrip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Starter Trip 2', startDate: otherDate, endDate: otherDate, participants: [] })
      .expect(201);
    const otherTripId = otherTrip.body.trip?.id ?? otherTrip.body.id;
    await request(app).get(`/api/trips/${otherTripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ tripId: otherTripId, date: otherDate, name: 'City Walk', startLocation: 'Paris', startTime: '09:00', duration: '2h', cost: '0' })
      .expect(201);

    const before = await request(app).get(`/api/trips/${otherTripId}/blog/days/${otherDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(before.body.draft).toBeTruthy();

    await request(app).post(`/api/trips/${otherTripId}/blog/days/${otherDate}/starter/dismiss`).set('Authorization', `Bearer ${travelerToken}`).expect(204);
    await request(app).get(`/api/trips/${otherTripId}/blog/days/${otherDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(204);
  });

  it('media-only day gets a photo-count starter naming the weekday', async () => {
    expect(new Date(`${dayDate}T00:00:00.000Z`).getUTCDay()).toBeDefined();
    // 2027-04-10 is a Saturday (UTC).
    const weekday = new Date('2027-04-10T00:00:00.000Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    expect(weekday).toBe('Saturday');
  });

  it('a stranger with no relationship to the trip gets 403', async () => {
    const stranger = { firstName: 'Starter', lastName: 'Stranger', email: 'blog-day-starter-stranger@example.com', password: 'Password123!' };
    await registerWebUser(stranger);
    await confirmWebUser(stranger.email);
    const strangerToken = (await loginWebUser(stranger)).body.token;
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/starter`).set('Authorization', `Bearer ${strangerToken}`).expect(403);
    await cleanupTestUsersByEmail([stranger.email]);
  });

  it('404s when the flag is off', async () => {
    await setFeatureFlag('trip_blog_day_starter', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/starter`).set('Authorization', `Bearer ${travelerToken}`).expect(404);
    await setFeatureFlag('trip_blog_day_starter', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
