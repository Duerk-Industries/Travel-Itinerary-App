import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('trip blog photo galleries', () => {
  const owner = { firstName: 'Gallery', lastName: 'Poster', email: 'blog-gallery@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
  const day = '2026-09-01';

  const uploadPhoto = async (idempotencyKey: string, galleryItemId?: string) => {
    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ dayDate: day, mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024, ...(galleryItemId ? { galleryItemId } : {}) });
    if (init.status !== 201) return init;
    await request(app).post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 }).expect(200);
    return init;
  };

  const getDay = async (localDate = day) => {
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    return blog.body.days.find((candidate: any) => candidate.localDate === localDate);
  };

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await setFeatureFlag('trip_blog_galleries', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Gallery Trip', startDate: day, endDate: day, participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });
  afterAll(async () => { await cleanupTestUsersByEmail([owner.email]); });

  it('rejects creating a gallery item while the flag is disabled', async () => {
    await setFeatureFlag('trip_blog_galleries', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${token}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(404);
    await setFeatureFlag('trip_blog_galleries', true, null);
    clearFeatureFlagCacheForTesting();
  });

  it('creates a gallery item and groups uploaded photos under it, ordered by position', async () => {
    const created = await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${token}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(201);
    expect(created.body.kindKey).toBe('core.gallery');
    const galleryId = created.body.id;

    await uploadPhoto('gallery-photo-1', galleryId);
    await uploadPhoto('gallery-photo-2', galleryId);
    await uploadPhoto('gallery-photo-3', galleryId);

    const dayResult = await getDay();
    const galleryItem = dayResult.items.find((item: any) => item.id === galleryId);
    expect(galleryItem).toBeDefined();
    expect(galleryItem.kindKey).toBe('core.gallery');
    expect(galleryItem.assets).toHaveLength(3);
    expect(galleryItem.assets.map((a: any) => a.position)).toEqual([0, 1, 2]);
    // Each asset inside the gallery keeps its own media kindKey so BlogMediaPreview renders it
    // unmodified, distinct from the parent gallery item's kindKey.
    expect(galleryItem.assets.every((a: any) => a.kindKey === 'media.photo')).toBe(true);
  });

  it('still creates a standalone item for an upload with no galleryItemId (regression)', async () => {
    await uploadPhoto('standalone-photo-1');
    const dayResult = await getDay();
    const standalone = dayResult.items.find((item: any) => item.assetId && item.kindKey === 'media.photo' && !item.assets);
    expect(standalone).toBeDefined();
  });

  it('rejects joining a nonexistent or foreign gallery item', async () => {
    await uploadPhoto('bad-gallery-1', '00000000-0000-0000-0000-000000000000').then((res) => expect(res.status).toBe(400));

    const otherOwner = { firstName: 'Other', lastName: 'Owner', email: 'blog-gallery-other@example.com', password: 'Password123!' };
    await registerWebUser(otherOwner);
    await confirmWebUser(otherOwner.email);
    const otherToken = (await loginWebUser(otherOwner)).body.token;
    const otherTrip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${otherToken}`).send({ name: 'Other Trip', startDate: day, endDate: day, participants: [] }).expect(201);
    const otherTripId = otherTrip.body.trip?.id ?? otherTrip.body.id;
    const otherGallery = await request(app).post(`/api/trips/${otherTripId}/blog/items`).set('Authorization', `Bearer ${otherToken}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(201);

    await uploadPhoto('bad-gallery-2', otherGallery.body.id).then((res) => expect(res.status).toBe(400));
    await cleanupTestUsersByEmail([otherOwner.email]);
  });

  it('enforces maxAssetsPerGallery', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-limit-test-'));
    const configPath = path.join(tempDir, 'api-limits.yaml');
    fs.writeFileSync(configPath, 'caching:\n  tripBlog:\n    maxAssetsPerGallery: 1\n');
    const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
    process.env.API_LIMITS_CONFIG_PATH = configPath;
    try {
      const created = await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${token}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(201);
      const galleryId = created.body.id;
      await uploadPhoto('limit-photo-1', galleryId).then((res) => expect(res.status).toBe(201));
      await uploadPhoto('limit-photo-2', galleryId).then((res) => expect(res.status).toBe(400));
    } finally {
      if (originalConfigPath === undefined) delete process.env.API_LIMITS_CONFIG_PATH;
      else process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('removes a single gallery photo, keeping the rest; removing the last photo removes the gallery', async () => {
    const created = await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${token}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(201);
    const galleryId = created.body.id;
    const first = await uploadPhoto('remove-photo-1', galleryId);
    await uploadPhoto('remove-photo-2', galleryId);

    let dayResult = await getDay();
    let galleryItem = dayResult.items.find((item: any) => item.id === galleryId);
    expect(galleryItem.assets).toHaveLength(2);
    const firstAssetId = first.body.asset.id;

    await request(app).delete(`/api/trips/${tripId}/blog/media/${firstAssetId}`).set('Authorization', `Bearer ${token}`).expect(204);
    dayResult = await getDay();
    galleryItem = dayResult.items.find((item: any) => item.id === galleryId);
    expect(galleryItem.assets).toHaveLength(1);

    const remainingAssetId = galleryItem.assets[0].assetId;
    await request(app).delete(`/api/trips/${tripId}/blog/media/${remainingAssetId}`).set('Authorization', `Bearer ${token}`).expect(204);
    dayResult = await getDay();
    expect(dayResult.items.find((item: any) => item.id === galleryId)).toBeUndefined();
  });

  it('rejects removing a single asset from a standalone (non-gallery) item', async () => {
    const standalone = await uploadPhoto('standalone-for-reject');
    await request(app).delete(`/api/trips/${tripId}/blog/media/${standalone.body.asset.id}`).set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('whole-gallery delete via DELETE /blog/items/:itemId hides all member assets at once', async () => {
    const created = await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${token}`).send({ kindKey: 'core.gallery', dayDate: day }).expect(201);
    const galleryId = created.body.id;
    await uploadPhoto('whole-delete-1', galleryId);
    await uploadPhoto('whole-delete-2', galleryId);

    const dayResult = await getDay();
    const galleryItem = dayResult.items.find((item: any) => item.id === galleryId);
    expect(galleryItem.assets).toHaveLength(2);

    await request(app).delete(`/api/trips/${tripId}/blog/items/${galleryId}`).set('Authorization', `Bearer ${token}`).send({ version: galleryItem.version }).expect(204);

    const afterDelete = await getDay();
    expect(afterDelete.items.find((item: any) => item.id === galleryId)).toBeUndefined();
    const mediaList = await request(app).get(`/api/trips/${tripId}/blog/media`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(mediaList.body.media.some((asset: any) => asset.blogItemId === galleryId)).toBe(false);
  });
});
