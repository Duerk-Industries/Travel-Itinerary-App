import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

// Phase 4 of docs/trip-blog-social-implementation-plan.md — "audience inheritance: a private
// comment stays private after publication; a public comment disappears on revoke; public counters
// never include private-audience rows." Architecture §4.1: a day's effective audience is resolved
// at the moment a comment is created and frozen on that row from then on — publishing the blog
// does not retroactively relabel comments written while it was private, and revoking it does not
// relabel comments written while it was public either. What *does* change on revoke is which
// comments the unauthenticated public route can still reach at all.
describe('comment audience is frozen at creation, not re-derived from current publication state', () => {
  const owner = { firstName: 'Audience', lastName: 'Owner', email: 'blog-audience-owner@example.com', password: 'Password123!' };
  const follower = { firstName: 'Audience', lastName: 'Follower', email: 'blog-audience-follower@example.com', password: 'Password123!' };

  let ownerToken = '';
  let ownerId = '';
  let followerToken = '';
  let followerId = '';
  let tripId = '';
  const dayDate = '2027-02-10';
  let dayId = '';
  const usernameSlug = 'audience-owner';
  const tripSlug = 'audience-trip';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_comments', true, null);
    await setFeatureFlag('trip_blog_public_engagement', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    const ownerLogin = await loginWebUser(owner);
    ownerToken = ownerLogin.body.token;
    ownerId = ownerLogin.body.user.id;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const followerLogin = await loginWebUser(follower);
    followerToken = followerLogin.body.token;
    followerId = followerLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Audience Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    dayId = blog.body.days[0].id;
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, follower.email]); });

  it('while private, a traveler\'s day comment is `travelers` audience and a follower\'s is `followers`', async () => {
    const travelerComment = await request(app)
      .post(`/api/trips/${tripId}/blog/day/${dayId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Written while private, by a traveler' })
      .expect(201);
    expect(travelerComment.body.audience).toBe('travelers');

    const followerComment = await request(app)
      .post(`/api/trips/${tripId}/blog/day/${dayId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Written while private, by a follower' })
      .expect(201);
    expect(followerComment.body.audience).toBe('followers');
  });

  it('publishing the blog does not retroactively relabel those existing comments', async () => {
    await queryBlog(`UPDATE trip_blogs SET visibility_state = 'public' WHERE trip_id = $1`, [tripId]);
    await queryBlog(
      `INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by) VALUES ($1, $2, 1, 'public', $3)`,
      [randomUUID(), tripId, ownerId]
    );
    await queryBlog(
      `INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [randomUUID(), tripId, ownerId, usernameSlug, tripSlug]
    );

    const dayFetch = await request(app)
      .get(`/api/trips/${tripId}/blog/comments`)
      .query({ dayDate })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const audiences = dayFetch.body.comments.map((c: any) => c.audience).sort();
    expect(audiences).toEqual(['followers', 'travelers']);
  });

  it('a comment written after publication inherits `public`, and only that one is visible on the unauthenticated route', async () => {
    const postPublishComment = await request(app)
      .post(`/api/trips/${tripId}/blog/day/${dayId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Written after publication' })
      .expect(201);
    expect(postPublishComment.body.audience).toBe('public');

    const publicRes = await request(app)
      .get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`)
      .query({ dayDate })
      .expect(200);
    const bodies = publicRes.body.comments.map((c: any) => c.body);
    expect(bodies).toEqual(['Written after publication']);
    expect(bodies).not.toContain('Written while private, by a traveler');
    expect(bodies).not.toContain('Written while private, by a follower');
  });

  it('revoking publication does not relabel the public comment, but it disappears from the unauthenticated route', async () => {
    await queryBlog(`UPDATE trip_blogs SET visibility_state = 'private' WHERE trip_id = $1`, [tripId]);
    await queryBlog(`UPDATE blog_publication_epochs SET state = 'revoked' WHERE trip_id = $1`, [tripId]);

    const dayFetch = await request(app)
      .get(`/api/trips/${tripId}/blog/comments`)
      .query({ dayDate })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const stillPublic = dayFetch.body.comments.find((c: any) => c.body === 'Written after publication');
    expect(stillPublic.audience).toBe('public'); // frozen — revoking doesn't relabel it either

    // The unauthenticated route resolves the alias only through an active `state = 'public'`
    // epoch (resolvePublicTripIdPostgres) — once revoked, the whole page 404s, taking every
    // comment on it out of unauthenticated reach regardless of any individual row's audience.
    await request(app).get(`/public/blog/${usernameSlug}/${tripSlug}/engagement`).query({ dayDate }).expect(404);
  });
});
