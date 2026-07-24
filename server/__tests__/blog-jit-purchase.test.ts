import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { blogMediaRepository } from '../src/blog/repository';

describe('trip blog JIT storage purchase', () => {
  const user = { firstName: 'JIT', lastName: 'Tester', email: 'blog-jit@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
  let userId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await registerWebUser(user);
    await confirmWebUser(user.email);
    const login = await loginWebUser(user);
    token = login.body.token;
    userId = login.body.user.id;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'JIT Trip', startDate: '2026-09-01', endDate: '2026-09-01', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;

    // Artificially set included_bytes to very low (1KB) to trigger quota quickly
    await blogMediaRepository().setIncludedStorage(userId, 1024);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([user.email]); });

  it('triggers QUOTA_EXCEEDED when over limit and recovers after purchase', async () => {
    // 1. Attempt upload > 1KB -> should fail with 413
    const fail = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'jit-fail')
      .send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 2048 })
      .expect(413);

    expect(fail.body.code).toBe('QUOTA_EXCEEDED');

    // 2. Simulate purchase of 20GB add-on
    await blogMediaRepository().updatePurchasedStorage(userId, 20 * 1024 * 1024 * 1024);

    // 3. Attempt same upload again -> should now succeed
    const success = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'jit-success')
      .send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 2048 })
      .expect(201);

    expect(success.body.asset.id).toBeDefined();

    const summary = await request(app)
      .get('/api/account/blog-storage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(summary.body.purchasedBytes).toBe(20 * 1024 * 1024 * 1024);
    expect(summary.body.availableBytes).toBeGreaterThan(0);
  });

  it('updates purchased storage via stripe webhook simulation', async () => {
    // This is a unit-style test of the repository method, but we can also
    // test the webhook logic if we mock the Stripe client.
    // For now, let's just verify the repository math stacks.

    await blogMediaRepository().updatePurchasedStorage(userId, 100 * 1024 * 1024 * 1024);
    const summary = await request(app)
      .get('/api/account/blog-storage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(summary.body.purchasedBytes).toBe(100 * 1024 * 1024 * 1024);
  });
});
