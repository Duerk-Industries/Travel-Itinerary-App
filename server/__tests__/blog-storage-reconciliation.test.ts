import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { blogMediaRepository } from '../src/blog/repository';
import { reconcileAllStorageAccounts } from '../src/services/blogStorageReconciliationService';

describe('trip blog storage reconciliation', () => {
  const user = { firstName: 'Reconcile', lastName: 'Tester', email: 'blog-reconcile@example.com', password: 'Password123!' };
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
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Reconcile Trip', startDate: '2026-09-01', endDate: '2026-09-01', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });

  afterAll(async () => { await cleanupTestUsersByEmail([user.email]); });

  it('hides media when account is over capacity during global reconciliation', async () => {
    // 1. Upload two photos (total 2MB)
    const init1 = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rec-1').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 * 1024 }).expect(201);
    await request(app).post(`/api/trips/${tripId}/blog/media/${init1.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 * 1024 }).expect(200);

    const init2 = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'rec-2').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 * 1024 }).expect(201);
    await request(app).post(`/api/trips/${tripId}/blog/media/${init2.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 * 1024 }).expect(200);

    // 2. Artificially lower quota to 1.5MB
    await blogMediaRepository().setIncludedStorage(userId, 1.5 * 1024 * 1024);

    // 3. Run global reconciliation
    await reconcileAllStorageAccounts();

    // 4. Verify that one photo is now grace_hidden
    const summary = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(summary.body.graceHiddenBytes).toBeGreaterThan(0);
    expect(summary.body.visibleCommittedBytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);

    const graceMedia = await request(app).get('/api/account/blog-storage/grace-media').set('Authorization', `Bearer ${token}`).expect(200);
    expect(graceMedia.body.media).toHaveLength(1);
  });
});
