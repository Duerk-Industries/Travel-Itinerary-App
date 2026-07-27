import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { randomUUID } from 'crypto';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('trip blog security boundaries', () => {
  const owner = { firstName: 'Sec', lastName: 'Owner', email: 'blog-sec-owner@example.com', password: 'Password123!' };
  const outsider = { firstName: 'Sec', lastName: 'Outsider', email: 'blog-sec-outsider@example.com', password: 'Password123!' };
  const follower = { firstName: 'Sec', lastName: 'Follower', email: 'blog-sec-follower@example.com', password: 'Password123!' };
  let ownerToken = '';
  let outsiderToken = '';
  let followerToken = '';
  let followerUserId = '';
  let tripId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);

    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    ownerToken = (await loginWebUser(owner)).body.token;

    await registerWebUser(outsider);
    await confirmWebUser(outsider.email);
    outsiderToken = (await loginWebUser(outsider)).body.token;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const followerLogin = await loginWebUser(follower);
    followerToken = followerLogin.body.token;
    followerUserId = followerLogin.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Security Trip', startDate: '2026-10-01', endDate: '2026-10-01', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;

    // Add `follower` as a read-only trip follower (not a group member) — mirrors how
    // ensureUserCanReadTrip's UNION branch is populated in production.
    await queryBlog(
      'INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)',
      [randomUUID(), tripId, followerUserId]
    );
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, outsider.email, follower.email]);
  });

  it('rejects a non-member, non-follower reading or writing the private blog (IDOR)', async () => {
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${outsiderToken}`).expect(403);
    await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ dayDate: '2026-10-01', body: 'Should not be allowed' })
      .expect(403);
  });

  it('lets a read-only follower view text and media, but never write', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dayDate: '2026-10-01', body: 'Owner entry' })
      .expect(201);

    // Regression: listMedia previously used the member-only check (ensureUserInTrip), which
    // rejected followers even though they are allowed to read the private blog.
    await request(app).get(`/api/trips/${tripId}/blog/media`).set('Authorization', `Bearer ${followerToken}`).expect(200);
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${followerToken}`).expect(200);

    await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ dayDate: '2026-10-01', body: 'Follower should not be able to write' })
      .expect(403);
    await request(app)
      .delete(`/api/trips/${tripId}/blog/items/${created.body.id}`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ version: created.body.version })
      .expect(403);
  });

  it('blocks item deletion and reorder once the trip_blog flag is disabled, matching create/update', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dayDate: '2026-10-01', body: 'Flag-gate regression item' })
      .expect(201);

    await setFeatureFlag('trip_blog', false, null);
    clearFeatureFlagCacheForTesting();
    try {
      await request(app)
        .delete(`/api/trips/${tripId}/blog/items/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: created.body.version })
        .expect(404);
      await request(app)
        .post(`/api/trips/${tripId}/blog/items/reorder`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ itemIds: [created.body.id] })
        .expect(404);
    } finally {
      await setFeatureFlag('trip_blog', true, null);
      clearFeatureFlagCacheForTesting();
    }
  });

  it('does not leak another uploader\'s asset when an idempotency key collides across users', async () => {
    const key = 'shared-idempotency-key';
    const ownerUpload = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', key)
      .send({ dayDate: '2026-10-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 2048 })
      .expect(201);

    // A second, unrelated trip/user reusing the exact same idempotency key must get their own
    // asset, never the first uploader's — the lookup must be scoped per-uploader.
    const secondTrip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'Outsider Trip', startDate: '2026-10-05', endDate: '2026-10-05', participants: [] })
      .expect(201);
    const outsiderTripId = secondTrip.body.trip?.id ?? secondTrip.body.id;

    const outsiderUpload = await request(app)
      .post(`/api/trips/${outsiderTripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('Idempotency-Key', key)
      .send({ dayDate: '2026-10-05', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 4096 })
      .expect(201);

    expect(outsiderUpload.body.asset.id).not.toBe(ownerUpload.body.asset.id);
    expect(outsiderUpload.body.asset.uploaderUserId).not.toBe(ownerUpload.body.asset.uploaderUserId);
  });

  it('never includes a travelers-only item in the public serializer output', async () => {
    const privateItem = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dayDate: '2026-10-01', body: 'This must stay private to travelers only', audience: 'travelers' })
      .expect(201);
    const publicItem = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dayDate: '2026-10-01', body: 'This is fine to publish' })
      .expect(201);

    // Owner is the trip's only account-holding member here (follower/outsider are not
    // consent-eligible), so requesting publication auto-approves through the real endpoint.
    await queryBlog("UPDATE users SET date_of_birth = '1990-01-01' WHERE id = (SELECT author_user_id FROM blog_items WHERE id = $1)", [publicItem.body.id]);
    await setFeatureFlag('trip_blog_public_sharing', true, null);
    clearFeatureFlagCacheForTesting();
    const publish = await request(app)
      .post(`/api/trips/${tripId}/blog/publication/request`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(publish.body.state).toBe('public');

    const alias = await queryBlog<{ username_slug: string; trip_slug: string }>(
      'SELECT username_slug, trip_slug FROM blog_public_aliases WHERE trip_id = $1 AND canonical = TRUE',
      [tripId]
    );
    const publicView = await request(app).get(`/public/blog/${alias.rows[0].username_slug}/${alias.rows[0].trip_slug}`).expect(200);
    const body = JSON.stringify(publicView.body);
    expect(body).not.toContain('This must stay private to travelers only');
    expect(body).toContain('This is fine to publish');
    expect(privateItem.body.audience).toBe('travelers');
  });
});
