import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// Phase 3 of docs/trip-blog-social-implementation-plan.md — the three reaction endpoints, live
// over HTTP. Extends the Phase 2 service-layer matrix test (blog-engagement-authorization.test.ts)
// to the actual routes, per that phase's "Tests" row.
describe('blog reaction routes (PUT/DELETE/GET .../reactions)', () => {
  const traveler = { firstName: 'Route', lastName: 'Traveler', email: 'blog-reaction-route-traveler@example.com', password: 'Password123!' };
  const follower = { firstName: 'Route', lastName: 'Follower', email: 'blog-reaction-route-follower@example.com', password: 'Password123!' };
  const stranger = { firstName: 'Route', lastName: 'Stranger', email: 'blog-reaction-route-stranger@example.com', password: 'Password123!' };

  let travelerToken = '';
  let followerToken = '';
  let strangerToken = '';
  let followerId = '';
  let tripId = '';
  let itemId = '';
  let travelersOnlyItemId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_reactions', true, null);

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    travelerToken = (await loginWebUser(traveler)).body.token;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const followerLogin = await loginWebUser(follower);
    followerToken = followerLogin.body.token;
    followerId = followerLogin.body.user.id;

    await registerWebUser(stranger);
    await confirmWebUser(stranger.email);
    strangerToken = (await loginWebUser(stranger)).body.token;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Reaction Route Trip', startDate: '2026-10-07', endDate: '2026-10-07', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);

    const item = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ kindKey: 'core.text', dayDate: '2026-10-07', body: 'React to this', audience: 'public' })
      .expect(201);
    itemId = item.body.id;

    const travelersOnly = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ kindKey: 'core.text', dayDate: '2026-10-07', body: 'Travelers only', audience: 'travelers' })
      .expect(201);
    travelersOnlyItemId = travelersOnly.body.id;
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email, follower.email, stranger.email]); });

  it('PUT sets a reaction and returns the full summary', async () => {
    const res = await request(app)
      .put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ emoji: 'heart' })
      .expect(200);
    expect(res.body.reactionTotal).toBe(1);
    expect(res.body.reactionCounts).toEqual({ heart: 1 });
    expect(res.body.userReaction).toBe('heart');
  });

  it('PUT is idempotent — replaying the same emoji never toggles it off', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'fire' }).expect(200);
    const replay = await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'fire' }).expect(200);
    expect(replay.body.userReaction).toBe('fire');
    expect(replay.body.reactionCounts.fire).toBe(1);
  });

  it('DELETE clears the reaction', async () => {
    const res = await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.userReaction).toBeNull();
    expect(res.body.reactionTotal).toBe(0);
  });

  it('rejects an invalid emoji with 400, and an invalid targetKind with 400', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'not-a-real-emoji' }).expect(400);
    await request(app).put(`/api/trips/${tripId}/blog/nonsense/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'heart' }).expect(400);
  });

  it('a stranger with no relationship to the trip gets 403', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${strangerToken}`).send({ emoji: 'heart' }).expect(403);
  });

  it('a follower reacting to a travelers-only item gets 404, not 403 (does not confirm existence)', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${travelersOnlyItemId}/reactions`).set('Authorization', `Bearer ${followerToken}`).send({ emoji: 'heart' }).expect(404);
  });

  it('a follower can react to a public item', async () => {
    const res = await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${followerToken}`).send({ emoji: 'laugh' }).expect(200);
    expect(res.body.reactionCounts.laugh).toBe(1);
    await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${followerToken}`).expect(200);
  });

  it('GET the reactor list returns identity, unlike the summary', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'clap' }).expect(200);
    const res = await request(app).get(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(res.body.reactors).toHaveLength(1);
    expect(res.body.reactors[0].emoji).toBe('clap');
    expect(res.body.reactors[0].displayName).toBeTruthy();
    await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
  });

  it('404s when the flag is off', async () => {
    await setFeatureFlag('trip_blog_reactions', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${travelerToken}`).send({ emoji: 'heart' }).expect(404);
    await setFeatureFlag('trip_blog_reactions', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
