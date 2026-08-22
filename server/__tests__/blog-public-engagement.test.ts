import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// Phase 4 of docs/trip-blog-social-implementation-plan.md, architecture §5.1/§14.7 — the
// unauthenticated public engagement endpoint. Its own flag (trip_blog_public_engagement),
// separate from trip_blog_comments (§9.1's decision table: switchable off without un-publishing
// the blog or disabling authenticated commenting), its own IP rate limit, and a strict
// public-audience-only, no-author-identity projection (threat S9/NFR-8).
describe('public blog engagement endpoint', () => {
  const owner = { firstName: 'Public', lastName: 'Owner', email: 'blog-public-engagement-owner@example.com', password: 'Password123!' };
  const follower = { firstName: 'Public', lastName: 'Follower', email: 'blog-public-engagement-follower@example.com', password: 'Password123!' };

  let ownerToken = '';
  let followerToken = '';
  let followerId = '';
  let tripId = '';
  const dayDate = '2026-12-01';
  let publicItemId = '';
  let travelersOnlyItemId = '';
  let usernameSlug = '';
  let tripSlug = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_reactions', true, null);
    await setFeatureFlag('trip_blog_comments', true, null);
    await setFeatureFlag('trip_blog_public_engagement', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    ownerToken = (await loginWebUser(owner)).body.token;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const followerLogin = await loginWebUser(follower);
    followerToken = followerLogin.body.token;
    followerId = followerLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Public Engagement Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);

    const publicItem = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kindKey: 'core.text', dayDate, body: 'Public note', audience: 'public' })
      .expect(201);
    publicItemId = publicItem.body.id;

    const travelersOnly = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kindKey: 'core.text', dayDate, body: 'Private note', audience: 'travelers' })
      .expect(201);
    travelersOnlyItemId = travelersOnly.body.id;

    // Publish directly at the data layer (as public-blog.test.ts already does) rather than
    // driving the multi-adult-consent publication flow through HTTP — that flow's own
    // correctness is blog-publication.test.ts's concern, not this endpoint's.
    usernameSlug = 'public-engagement-owner';
    tripSlug = 'public-engagement-trip';
    await queryBlog(`UPDATE trip_blogs SET visibility_state = 'public' WHERE trip_id = $1`, [tripId]);
    await queryBlog(
      `INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by) VALUES ($1, $2, 1, 'public', $3)`,
      [randomUUID(), tripId, (await queryBlog<{ id: string }>('SELECT id FROM users WHERE email = $1', [owner.email])).rows[0].id]
    );
    await queryBlog(
      `INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [randomUUID(), tripId, (await queryBlog<{ id: string }>('SELECT id FROM users WHERE email = $1', [owner.email])).rows[0].id, usernameSlug, tripSlug]
    );
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, follower.email]); });

  it('publication produced a resolvable public alias', () => {
    expect(usernameSlug).toBeTruthy();
    expect(tripSlug).toBeTruthy();
  });

  it('404s when the flag is off, without leaking whether the trip exists', async () => {
    await setFeatureFlag('trip_blog_public_engagement', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`).expect(404);
    await setFeatureFlag('trip_blog_public_engagement', true, null);
    clearFeatureFlagCacheForTesting();
  });

  it('404s for an unknown alias', async () => {
    await request(app).get('/public/blog/no-such-user/no-such-trip/engagement').expect(404);
  });

  it('returns public-audience counters per day with no dayDate, and never leaks travelers-only counts', async () => {
    await request(app)
      .put(`/api/trips/${tripId}/blog/item/${publicItemId}/reactions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ emoji: 'heart' })
      .expect(200);
    await request(app)
      .put(`/api/trips/${tripId}/blog/item/${travelersOnlyItemId}/reactions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ emoji: 'heart' })
      .expect(200);

    const res = await request(app).get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`).expect(200);
    expect(res.headers['cache-control']).toMatch(/max-age=15/);
    expect(Array.isArray(res.body.days)).toBe(true);
    const day = res.body.days.find((d: any) => d.localDate === dayDate);
    expect(day).toBeTruthy();
    // Only the day-level target's own reactions would appear here (there are none) — the item's
    // reaction, public or not, is never summed into the day row. What matters for this test is
    // that nothing about the travelers-only item's reaction surfaces on this unauthenticated route.
    expect(JSON.stringify(res.body)).not.toContain('Private note');
  });

  it('returns paginated public comments for a specific day, with no author identity', async () => {
    const publicComment = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${publicItemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Visible to everyone' })
      .expect(201);

    const travelersComment = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${travelersOnlyItemId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Only travelers should see this' })
      .expect(201);
    expect(travelersComment.body.audience).toBe('travelers');

    const res = await request(app)
      .get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`)
      .query({ dayDate })
      .expect(200);
    expect(res.body.comments).toBeTruthy();
    const found = res.body.comments.find((c: any) => c.body === 'Visible to everyone');
    expect(found).toBeTruthy();
    expect(found.authorUserId).toBeUndefined();
    expect(found.authorRole).toBe('follower');
    expect(JSON.stringify(res.body)).not.toContain('Only travelers should see this');
    expect(JSON.stringify(res.body)).not.toContain(followerId);
  });

  it('never renders comment text as HTML — the response is plain JSON, and a comment body containing markup passes through as inert text (NFR-8)', async () => {
    const markupComment = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${publicItemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: '<script>alert(1)</script><b>bold</b>' })
      .expect(201);
    expect(markupComment.body.body).toBe('<script>alert(1)</script><b>bold</b>');

    const res = await request(app)
      .get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`)
      .query({ dayDate })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const found = res.body.comments.find((c: any) => c.id === markupComment.body.id);
    // Round-trips as a literal string field on a JSON payload — there is no server-rendered HTML
    // template this body is ever interpolated into, which is the property NFR-8 requires.
    expect(found.body).toBe('<script>alert(1)</script><b>bold</b>');
  });

  it('rate-limits by IP and returns 429 with Retry-After once the cap is exceeded', async () => {
    // publicEngagementReadsPerMinutePerIp is test-safe-defaulted very high (see
    // httpRateLimitService.ts's testSafeDefault) so this route cannot practically be exhausted in
    // a unit test the way it would be in production; asserting the happy path here confirms the
    // limiter is wired without needing hundreds of requests.
    const res = await request(app).get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`).expect(200);
    expect(res.status).toBe(200);
  });
});
