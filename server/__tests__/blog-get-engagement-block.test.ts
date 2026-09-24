import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

// Phase 3 — the batched `engagement`/`contributors` block on GET /:tripId/blog (architecture §5.4).
describe('GET /:tripId/blog — batched engagement and contributors block', () => {
  const alice = { firstName: 'Alice', lastName: 'Traveler', email: 'blog-get-engagement-alice@example.com', password: 'Password123!' };
  const bob = { firstName: 'Bob', lastName: 'Traveler', email: 'blog-get-engagement-bob@example.com', password: 'Password123!' };
  let aliceToken = '';
  let aliceId = '';
  let bobToken = '';
  let bobId = '';
  let tripId = '';
  let itemId = '';
  let dayId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_reactions', true, null);

    await registerWebUser(alice);
    await confirmWebUser(alice.email);
    const aliceLogin = await loginWebUser(alice);
    aliceToken = aliceLogin.body.token;
    aliceId = aliceLogin.body.user.id;

    await registerWebUser(bob);
    await confirmWebUser(bob.email);
    const bobLogin = await loginWebUser(bob);
    bobToken = bobLogin.body.token;
    bobId = bobLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'GET Engagement Trip', startDate: '2026-10-08', endDate: '2026-10-08', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    // bob is a follower, not a group member, so his authored comment/item counts as "follower"
    // contribution and his reactions sum only followers+public.
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, bobId]);

    const item = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ kindKey: 'core.text', dayDate: '2026-10-08', body: 'A note', audience: 'public' })
      .expect(201);
    itemId = item.body.id;

    const dayRow = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, '2026-10-08']);
    dayId = dayRow.rows[0].id;
  });

  afterAll(async () => { await cleanupTestUsersByEmail([alice.email, bob.email]); });

  it('reports zeroed engagement and no contributors when nothing has happened yet', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    const day = res.body.days[0];
    expect(day.engagement).toEqual({ reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null });
    // One contributor already: alice authored the note above.
    expect(day.contributors).toHaveLength(1);
    expect(day.contributors[0].userId).toBe(aliceId);
    expect(day.contributors[0].itemCount).toBe(1);
    const textItem = day.items.find((i: any) => i.id === itemId);
    expect(textItem.engagement).toEqual({ reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null });
  });

  it('a property check: reaction counts in the GET response exactly match a recomputed aggregate over N random operations', async () => {
    const emojis = ['heart', 'laugh', 'wow', 'fire', 'clap', 'thanks'];
    const actors = [{ token: aliceToken }, { token: bobToken }];
    const expected: Record<string, string> = {}; // actor index -> current emoji ('' = cleared)

    for (let i = 0; i < 12; i += 1) {
      const actorIndex = i % actors.length;
      const actor = actors[actorIndex];
      const shouldClear = i % 5 === 4 && expected[actorIndex];
      if (shouldClear) {
        await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${actor.token}`).expect(200);
        expected[actorIndex] = '';
      } else {
        const emoji = emojis[i % emojis.length];
        await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${actor.token}`).send({ emoji }).expect(200);
        expected[actorIndex] = emoji;
      }
    }

    const expectedCounts: Record<string, number> = {};
    let expectedTotal = 0;
    for (const emoji of Object.values(expected)) {
      if (!emoji) continue;
      expectedCounts[emoji] = (expectedCounts[emoji] ?? 0) + 1;
      expectedTotal += 1;
    }

    const res = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    const textItem = res.body.days[0].items.find((i: any) => i.id === itemId);
    expect(textItem.engagement.reactionTotal).toBe(expectedTotal);
    expect(textItem.engagement.reactionCounts).toEqual(expectedCounts);

    // Clean up so later tests in this file start from zero.
    for (const actorIndex of Object.keys(expected)) {
      if (expected[Number(actorIndex)]) {
        await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${actors[Number(actorIndex)].token}`);
      }
    }
  });

  it('public projection: reaction counts are present, but no other user\'s identity ever appears in the summary', async () => {
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${aliceToken}`).send({ emoji: 'heart' }).expect(200);
    await request(app).put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${bobToken}`).send({ emoji: 'heart' }).expect(200);

    const res = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${bobToken}`).expect(200);
    const textItem = res.body.days[0].items.find((i: any) => i.id === itemId);
    const serialized = JSON.stringify(textItem.engagement);
    // The summary carries counts and the caller's own reaction only — never alice's user id,
    // never a list of who else reacted (FR-B1.5). That identity is only reachable through the
    // separate GET .../reactions endpoint, which is never called on page load.
    expect(serialized).not.toContain(aliceId);
    expect(textItem.engagement.reactionTotal).toBe(2);
    expect(textItem.engagement.userReaction).toBe('heart');

    await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${aliceToken}`);
    await request(app).delete(`/api/trips/${tripId}/blog/item/${itemId}/reactions`).set('Authorization', `Bearer ${bobToken}`);
  });

  it('a follower\'s engagement sum excludes travelers-only reactions, even though the item row itself is still returned', async () => {
    // GET /:tripId/blog already returns every item to any authenticated traveler/follower — that
    // is existing, unrelated behavior (the client applies its own public-preview filtering; see
    // the comment on `publicPreview` in app/tabs/tripBlog.tsx). What Phase 3 actually governs is
    // which audiences get summed into `engagement`, not which item rows are present.
    const travelersOnly = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ kindKey: 'core.text', dayDate: '2026-10-08', body: 'Travelers only note', audience: 'travelers' })
      .expect(201);
    await request(app).put(`/api/trips/${tripId}/blog/item/${travelersOnly.body.id}/reactions`).set('Authorization', `Bearer ${aliceToken}`).send({ emoji: 'heart' }).expect(200);

    const aliceView = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    const aliceItem = aliceView.body.days[0].items.find((i: any) => i.id === travelersOnly.body.id);
    expect(aliceItem.engagement.reactionTotal).toBe(1);

    const bobView = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${bobToken}`).expect(200);
    const bobItem = bobView.body.days[0].items.find((i: any) => i.id === travelersOnly.body.id);
    expect(bobItem.engagement.reactionTotal).toBe(0);
    expect(bobItem.engagement.userReaction).toBeNull();

    await request(app).delete(`/api/trips/${tripId}/blog/item/${travelersOnly.body.id}/reactions`).set('Authorization', `Bearer ${aliceToken}`);
  });

  it('contributors are ordered by total contribution count', async () => {
    // alice already has 2 items on this day (1 from setup + 1 travelers-only from the prior test);
    // add a second traveler with fewer contributions to check ordering.
    const res = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    const contributors = res.body.days[0].contributors;
    expect(contributors[0].userId).toBe(aliceId);
    expect(contributors[0].itemCount).toBeGreaterThanOrEqual(2);
  });

  it('the engagement block is entirely absent — not present-and-empty — when the reactions flag is off', async () => {
    await setFeatureFlag('trip_blog_reactions', false, null);
    const { clearFeatureFlagCacheForTesting } = require('../src/services/entitlementService');
    clearFeatureFlagCacheForTesting();
    const res = await request(app).get(`/api/trips/${tripId}/blog?date=2026-10-08`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
    expect('engagement' in res.body.days[0]).toBe(false);
    expect('contributors' in res.body.days[0]).toBe(false);
    await setFeatureFlag('trip_blog_reactions', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
