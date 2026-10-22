import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag, deleteWebUserAndCleanup } from '../src/db';
import { addTripMember, commentRow, counterRows, reactionRows } from './providerRows';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

// Phase 4 of docs/trip-blog-social-implementation-plan.md — "confirm/verify account-deletion
// behavior scrubs comment body/author, preserves a required tombstone, deletes reactions, and
// adjusts counters transactionally." A shared trip (more than one group member) survives its own
// deletion path: only the departing member's comments/reactions are affected, not the trip.
describe('account deletion scrubs blog engagement data', () => {
  const owner = { firstName: 'Scrub', lastName: 'Owner', email: 'blog-scrub-owner@example.com', password: 'Password123!' };
  const departing = { firstName: 'Scrub', lastName: 'Departing', email: 'blog-scrub-departing@example.com', password: 'Password123!' };

  let ownerToken = '';
  let departingToken = '';
  let departingId = '';
  let tripId = '';
  const dayDate = '2027-01-05';
  let itemId = '';
  let commentId = '';
  let replyId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_social_layer', true, null);
    await setFeatureFlag('trip_blog_reactions', true, null);
    await setFeatureFlag('trip_blog_comments', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    ownerToken = (await loginWebUser(owner)).body.token;

    await registerWebUser(departing);
    await confirmWebUser(departing.email);
    const departingLogin = await loginWebUser(departing);
    departingToken = departingLogin.body.token;
    departingId = departingLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Scrub Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await addTripMember(tripId, departingId);

    const item = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kindKey: 'core.text', dayDate, body: 'React and comment here', audience: 'public' })
      .expect(201);
    itemId = item.body.id;

    await request(app)
      .put(`/api/trips/${tripId}/blog/item/${itemId}/reactions`)
      .set('Authorization', `Bearer ${departingToken}`)
      .send({ emoji: 'heart' })
      .expect(200);

    const comment = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${departingToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'A comment with personal details in it' })
      .expect(201);
    commentId = comment.body.id;

    // A reply from the owner, so the departing user's comment has a reply and must tombstone
    // rather than vanish (FR-B2.4's rule, exercised here by account deletion rather than a
    // self-service DELETE).
    const reply = await request(app)
      .post(`/api/trips/${tripId}/blog/item/${itemId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Replying to keep the thread going', parentCommentId: commentId })
      .expect(201);
    replyId = reply.body.id;

    await deleteWebUserAndCleanup(departingId);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email]); });

  it('the trip and its blog survive — only the departing member is gone', async () => {
    const res = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(res.body).toBeTruthy();
  });

  it('the reaction is deleted, not merely orphaned, and the counter no longer includes it', async () => {
    expect(await reactionRows([itemId])).toHaveLength(0);
    const counter = (await counterRows([itemId])).find((row) => row.targetKind === 'item' && row.audience === 'public');
    expect(counter?.reactionTotal ?? 0).toBe(0);
  });

  it('the comment becomes an anonymous tombstone — body scrubbed, author cleared, row preserved for the reply', async () => {
    const row = await commentRow(commentId);
    expect(row).toBeDefined();
    expect(row!.body).toBeNull();
    expect(row!.authorUserId).toBeNull();
    expect(row!.deletedAt).toBeTruthy();
    expect(await commentRow(replyId)).toBeDefined();
  });

  it('the tombstoned comment no longer counts toward the visible comment count', async () => {
    const counter = (await counterRows([itemId])).find((row) => row.targetKind === 'item' && row.audience === 'public');
    // The reply (still authored by the owner, never deleted) is the only comment still counted.
    expect(counter?.commentCount ?? 0).toBe(1);
  });
});
