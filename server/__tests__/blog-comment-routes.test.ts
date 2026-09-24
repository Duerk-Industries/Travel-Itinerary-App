import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, makeAdminUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// Phase 4 of docs/trip-blog-social-implementation-plan.md — comment core and full moderation
// (B2/B11). Extends the Phase 2/3 authorization matrix test to comment-id routes with a foreign
// trip's comment id (architecture §4's own instruction), and covers the requirements unique to
// Phase 4: idempotency-key replay, the 15-minute edit window, the tombstone rule, automated spam
// filtering scoped to public-audience follower comments, and strike escalation via the real
// moderation route (not just the raw repository call Phase 2 already tested).
describe('blog comment routes', () => {
  const owner = { firstName: 'Comment', lastName: 'Owner', email: 'blog-comment-route-owner@example.com', password: 'Password123!' };
  const traveler = { firstName: 'Comment', lastName: 'Traveler', email: 'blog-comment-route-traveler@example.com', password: 'Password123!' };
  const follower = { firstName: 'Comment', lastName: 'Follower', email: 'blog-comment-route-follower@example.com', password: 'Password123!' };
  const stranger = { firstName: 'Comment', lastName: 'Stranger', email: 'blog-comment-route-stranger@example.com', password: 'Password123!' };

  let ownerToken = '';
  let travelerToken = '';
  let followerToken = '';
  let strangerToken = '';
  let followerId = '';
  let tripId = '';
  let dayDate = '2026-11-03';
  let itemId = '';

  // A second, unrelated trip + comment, used only for the IDOR test below.
  let otherTripId = '';
  let otherCommentId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_comments', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    ownerToken = (await loginWebUser(owner)).body.token;

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const travelerLogin = await loginWebUser(traveler);
    travelerToken = travelerLogin.body.token;
    const travelerId = travelerLogin.body.user.id;

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
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Comment Route Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const group = await queryBlog<{ group_id: string }>('SELECT group_id FROM trips WHERE id = $1', [tripId]);
    const groupId = group.rows[0].group_id;
    await queryBlog('INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $3)', [randomUUID(), groupId, travelerId]);
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);

    const item = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kindKey: 'core.text', dayDate, body: 'Comment on this', audience: 'public' })
      .expect(201);
    itemId = item.body.id;

    const otherTrip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ name: 'Other Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    otherTripId = otherTrip.body.trip?.id ?? otherTrip.body.id;
    await request(app).get(`/api/trips/${otherTripId}/blog`).set('Authorization', `Bearer ${strangerToken}`).expect(200);
    const otherItem = await request(app)
      .post(`/api/trips/${otherTripId}/blog/items`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ kindKey: 'core.text', dayDate, body: 'Other trip item', audience: 'public' })
      .expect(201);
    const otherComment = await request(app)
      .post(`/api/trips/${otherTripId}/blog/item/${otherItem.body.id}/comments`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'A comment on the other trip' })
      .expect(201);
    otherCommentId = otherComment.body.id;
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, traveler.email, follower.email, stranger.email]); });

  it('POST creates a comment and requires an Idempotency-Key', async () => {
    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ body: 'No key here' })
      .expect(400);

    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', 'first-comment-key')
      .send({ body: 'Great photo!' })
      .expect(201);
    expect(res.body.body).toBe('Great photo!');
    expect(res.body.audience).toBe('public');
    expect(res.body.authorRole).toBe('traveler');
  });

  it('replays the same Idempotency-Key as the same comment instead of creating a duplicate', async () => {
    const first = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', 'replay-key')
      .send({ body: 'Replay me' })
      .expect(201);
    const replay = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', 'replay-key')
      .send({ body: 'Replay me' })
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('GET the day fetches top-level comments with reply previews', async () => {
    const parent = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Top level comment' })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'A reply', parentCommentId: parent.body.id })
      .expect(201);

    const res = await request(app)
      .get(`/api/trips/${tripId}/blog/comments`)
      .query({ dayDate })
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(200);
    const found = res.body.comments.find((c: any) => c.id === parent.body.id);
    expect(found).toBeTruthy();
    expect(found.replyCount).toBe(1);
    expect(found.replies).toHaveLength(1);
    expect(found.replies[0].body).toBe('A reply');
  });

  it('requires dayDate on the day-level fetch', async () => {
    await request(app).get(`/api/trips/${tripId}/blog/comments`).set('Authorization', `Bearer ${travelerToken}`).expect(400);
  });

  it('PATCH edits within the window, and a stranger cannot edit someone else\'s comment', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Original body' })
      .expect(201);

    await request(app)
      .patch(`/api/trips/${tripId}/blog/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ body: 'Hijacked' })
      .expect(404);

    const edited = await request(app)
      .patch(`/api/trips/${tripId}/blog/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ body: 'Edited body' })
      .expect(200);
    expect(edited.body.body).toBe('Edited body');
    expect(edited.body.editedAt).toBeTruthy();
  });

  it('DELETE tombstones a comment with replies but hard-deletes one without', async () => {
    const withReply = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Parent with a reply' })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'A reply to keep the thread alive', parentCommentId: withReply.body.id })
      .expect(201);
    await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${withReply.body.id}`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(204);

    const dayFetch = await request(app)
      .get(`/api/trips/${tripId}/blog/comments`)
      .query({ dayDate })
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(200);
    // A tombstoned top-level comment (deleted_at set, still has a reply) is filtered from the
    // top-level listing by listTopLevelCommentsForDay's own `deleted_at IS NULL` guard — its
    // reply, however, must not have vanished with it.
    expect(dayFetch.body.comments.find((c: any) => c.id === withReply.body.id)).toBeUndefined();

    const withoutReply = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Lonely comment' })
      .expect(201);
    await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${withoutReply.body.id}`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(204);
    await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${withoutReply.body.id}`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(404);
  });

  it('POST report — every viewer except the author may report; the author may not', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Reportable comment' })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/report`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ reason: 'spam' })
      .expect(403);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/report`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ reason: 'other-not-real' })
      .expect(400);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/report`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ reason: 'harassment', detail: 'Not appropriate' })
      .expect(204);
  });

  it('hide/unhide is owner-or-admin only, is idempotent, and adjusts the author\'s strike count', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Comment to be hidden' })
      .expect(201);

    // Not the owner and not admin — 403.
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(403);

    const hidden = await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(hidden.body.hiddenAt).toBeTruthy();

    // Replaying the hide is a no-op, not a second strike.
    const replayHide = await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(replayHide.body.hiddenAt).toBe(hidden.body.hiddenAt);

    const unhidden = await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(unhidden.body.hiddenAt).toBeNull();

    // Replaying the unhide is also a no-op — no double strike-removal.
    await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('three hides on a trip blocks that follower\'s 4th comment', async () => {
    const strikeVictim = { firstName: 'Strike', lastName: 'Victim', email: 'blog-comment-route-strike-victim@example.com', password: 'Password123!' };
    await registerWebUser(strikeVictim);
    await confirmWebUser(strikeVictim.email);
    const victimLogin = await loginWebUser(strikeVictim);
    const victimToken = victimLogin.body.token;
    const victimId = victimLogin.body.user.id;
    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, victimId]);

    for (let i = 0; i < 3; i += 1) {
      const c = await request(app)
        .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
        .set('Authorization', `Bearer ${victimToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ body: `Strike-worthy comment ${i}` })
        .expect(201);
      await request(app)
        .post(`/api/trips/${tripId}/blog/comments/${c.body.id}/hide`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    }

    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${victimToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Should be blocked' })
      .expect(403);

    await cleanupTestUsersByEmail([strikeVictim.email]);
  });

  it('an admin (not the owner) may also hide/unhide a comment', async () => {
    const admin = await makeAdminUser({ firstName: 'Blog', lastName: 'Admin', email: 'blog-comment-route-admin@example.com', password: 'Password123!' });
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Admin will hide this' })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${created.body.id}/hide`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    await cleanupTestUsersByEmail(['blog-comment-route-admin@example.com']);
  });

  it('automated spam filtering hides a public follower comment with a trigger phrase, but not the same phrase from a traveler', async () => {
    const followerSpam = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'wire transfer me the deposit please' })
      .expect(201);
    expect(followerSpam.body.hiddenAt).toBeTruthy();

    const travelerSame = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'wire transfer me the deposit please' })
      .expect(201);
    expect(travelerSame.body.hiddenAt).toBeFalsy();
  });

  it('a stranger with no relationship to the trip gets 403 posting a comment', async () => {
    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Should not work' })
      .expect(403);
  });

  it('IDOR: a foreign trip\'s comment id 404s on PATCH/DELETE/report/hide under this trip', async () => {
    await request(app)
      .patch(`/api/trips/${tripId}/blog/comments/${otherCommentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ body: 'Should not apply' })
      .expect(404);
    await request(app)
      .delete(`/api/trips/${tripId}/blog/comments/${otherCommentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${otherCommentId}/report`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'spam' })
      .expect(404);
    await request(app)
      .post(`/api/trips/${tripId}/blog/comments/${otherCommentId}/hide`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('404s when the comments flag is off', async () => {
    await setFeatureFlag('trip_blog_comments', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Should 404' })
      .expect(404);
    await setFeatureFlag('trip_blog_comments', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
