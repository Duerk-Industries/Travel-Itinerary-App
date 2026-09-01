import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { blogMediaRepository } from '../src/blog/repository';

describe('trip blog media quota lifecycle', () => {
  const owner = { firstName: 'Media', lastName: 'Uploader', email: 'blog-media@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
  let userId = '';
  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    const login = await loginWebUser(owner);
    token = login.body.token;
    userId = login.body.user.id;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Media Trip', startDate: '2026-09-01', endDate: '2026-09-01', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });
  afterAll(async () => { await cleanupTestUsersByEmail([owner.email]); });

  it('reserves, completes, and accounts an uploader-owned photo', async () => {
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-1').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 2048 }).expect(201);
    expect(init.body.asset.uploaderUserId).toBeDefined();
    await request(app).post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 2048 }).expect(200);
    const summary = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(summary.body.visibleCommittedBytes).toBe(2048);
    const media = await request(app).get(`/api/trips/${tripId}/blog/media`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(media.body.media).toHaveLength(1);
  });

  it('persists a client-supplied capturedAt and nulls an unparseable one', async () => {
    const good = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-capturedat').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 512, capturedAt: '2026-09-01T14:30:00' }).expect(201);
    await request(app).post(`/api/trips/${tripId}/blog/media/${good.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 512 }).expect(200);

    const bad = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-capturedat-bad').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 512, capturedAt: 'not-a-date' }).expect(201);
    await request(app).post(`/api/trips/${tripId}/blog/media/${bad.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 512 }).expect(200);

    const media = await request(app).get(`/api/trips/${tripId}/blog/media`).set('Authorization', `Bearer ${token}`).expect(200);
    const goodAsset = media.body.media.find((m: any) => m.id === good.body.asset.id);
    const badAsset = media.body.media.find((m: any) => m.id === bad.body.asset.id);
    expect(goodAsset.capturedAt).toContain('2026-09-01');
    expect(badAsset.capturedAt).toBeNull();
  });

  it('rejects unsupported image formats before reserving bytes', async () => {
    await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-heic').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/heic', byteSize: 2048 }).expect(400);
  });

  it('atomically charges generated rendition bytes above the original reservation', async () => {
    const before = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'photo-rendition-overhead')
      .send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1000 })
      .expect(201);

    const completed = await request(app)
      .post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ physicalBytes: 1200 })
      .expect(200);

    expect(completed.body.physicalBytes).toBe(1200);
    expect(completed.body.billableBytes).toBe(1200);
    const after = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.visibleCommittedBytes).toBe(before.body.visibleCommittedBytes + 1200);
    expect(after.body.reservedBytes).toBe(before.body.reservedBytes);
  });

  it('leaves the reservation untouched when rendition overhead exceeds quota, then permits a smaller retry', async () => {
    const before = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    await blogMediaRepository().setIncludedStorage(userId, before.body.visibleCommittedBytes + 1100);
    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'photo-rendition-overhead-quota')
      .send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1000 })
      .expect(201);

    const reserved = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app)
      .post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ physicalBytes: 1200 })
      .expect(413, { error: 'QUOTA_EXCEEDED', code: 'QUOTA_EXCEEDED' });

    const rejected = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(rejected.body.visibleCommittedBytes).toBe(reserved.body.visibleCommittedBytes);
    expect(rejected.body.reservedBytes).toBe(reserved.body.reservedBytes);

    await request(app)
      .post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ physicalBytes: 1100 })
      .expect(200);
    const completed = await request(app).get('/api/account/blog-storage').set('Authorization', `Bearer ${token}`).expect(200);
    expect(completed.body.visibleCommittedBytes).toBe(before.body.visibleCommittedBytes + 1100);
    expect(completed.body.reservedBytes).toBe(before.body.reservedBytes);
    await blogMediaRepository().setIncludedStorage(userId, before.body.includedBytes);
  });

  it('exposes the blog_items id (not the media asset id) via GET /blog, and Remove actually removes it', async () => {
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-remove').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 }).expect(201);
    const assetId = init.body.asset.id;
    await request(app).post(`/api/trips/${tripId}/blog/media/${assetId}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 }).expect(200);

    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const day = blog.body.days.find((candidate: any) => candidate.localDate === '2026-09-01');
    const mediaItem = day.items.find((item: any) => item.assetId === assetId);
    expect(mediaItem).toBeDefined();
    // Regression: the merged media item's `id` must be the blog_items row id, not the asset's own
    // id — the client's PATCH/DELETE /blog/items/:itemId calls target blog_items, so shipping the
    // asset id here made every UI action against a photo/video silently fail (wrong row, 404/409).
    expect(mediaItem.id).not.toBe(assetId);

    await request(app)
      .delete(`/api/trips/${tripId}/blog/items/${mediaItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: mediaItem.version })
      .expect(204);

    // Regression: deleting only ever touched blog_items, not blog_media_assets, so listMedia (and
    // therefore the day's item list) must independently exclude assets whose blog_items row is
    // soft-deleted, or the "removed" photo reappears on the next load.
    const afterDelete = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const dayAfter = afterDelete.body.days.find((candidate: any) => candidate.localDate === '2026-09-01');
    expect((dayAfter.items || []).some((item: any) => item.assetId === assetId)).toBe(false);

    const mediaList = await request(app).get(`/api/trips/${tripId}/blog/media`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(mediaList.body.media.some((item: any) => item.id === assetId)).toBe(false);
  });
});
