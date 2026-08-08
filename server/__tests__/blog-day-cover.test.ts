import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('trip blog day cover selection', () => {
  const owner = { firstName: 'Cover', lastName: 'Owner', email: 'blog-day-cover-owner@example.com', password: 'Password123!' };
  const outsider = { firstName: 'Cover', lastName: 'Outsider', email: 'blog-day-cover-outsider@example.com', password: 'Password123!' };
  let token = '';
  let outsiderToken = '';
  let tripId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    await registerWebUser(outsider);
    await confirmWebUser(outsider.email);
    outsiderToken = (await loginWebUser(outsider)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Cover Trip', startDate: '2026-09-10', endDate: '2026-09-11', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });
  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, outsider.email]); });

  const uploadReadyPhoto = async (dayDate: string, idempotencyKey: string): Promise<{ assetId: string; itemId: string }> => {
    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ dayDate, mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 })
      .expect(201);
    const assetId = init.body.asset.id;
    await request(app).post(`/api/trips/${tripId}/blog/media/${assetId}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 }).expect(200);
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const day = blog.body.days.find((candidate: any) => candidate.localDate === dayDate);
    const item = day.items.find((candidate: any) => candidate.assetId === assetId);
    return { assetId, itemId: item.id };
  };

  it('falls back to the most-recently-uploaded photo when no cover is explicitly set', async () => {
    const first = await uploadReadyPhoto('2026-09-10', 'cover-fallback-1');
    const second = await uploadReadyPhoto('2026-09-10', 'cover-fallback-2');
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const day = blog.body.days.find((candidate: any) => candidate.localDate === '2026-09-10');
    expect(day.coverIsExplicit).toBe(false);
    expect(day.coverItemId).toBe(second.itemId);
    expect(first.itemId).not.toBe(second.itemId);
  });

  it('lets a traveler set an explicit day cover, reflected on the next GET /blog', async () => {
    const first = await uploadReadyPhoto('2026-09-10', 'cover-explicit-1');
    await uploadReadyPhoto('2026-09-10', 'cover-explicit-2');
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: first.assetId })
      .expect(204);
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const day = blog.body.days.find((candidate: any) => candidate.localDate === '2026-09-10');
    expect(day.coverIsExplicit).toBe(true);
    expect(day.coverItemId).toBe(first.itemId);
  });

  it('rejects setting a cover to an asset that belongs to a different day', async () => {
    const otherDay = await uploadReadyPhoto('2026-09-11', 'cover-wrong-day');
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: otherDay.assetId })
      .expect(400);
  });

  it('rejects setting a cover to a non-ready (still-uploading) asset', async () => {
    const init = await request(app)
      .post(`/api/trips/${tripId}/blog/media/upload-init`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'cover-not-ready')
      .send({ dayDate: '2026-09-10', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 })
      .expect(201);
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: init.body.asset.id })
      .expect(400);
  });

  it('rejects a non-trip-member from setting a day cover', async () => {
    const asset = await uploadReadyPhoto('2026-09-10', 'cover-outsider');
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ assetId: asset.assetId })
      .expect(403);
  });

  it('bumps the blog ETag after a cover-set call', async () => {
    const asset = await uploadReadyPhoto('2026-09-10', 'cover-etag');
    const before = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const etagBefore = before.headers.etag;
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: asset.assetId })
      .expect(204);
    const after = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.headers.etag).not.toBe(etagBefore);
  });

  it('clears an explicit cover back to the fallback when assetId is null', async () => {
    const asset = await uploadReadyPhoto('2026-09-10', 'cover-clear');
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: asset.assetId })
      .expect(204);
    await request(app)
      .post(`/api/trips/${tripId}/blog/days/2026-09-10/cover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assetId: null })
      .expect(204);
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const day = blog.body.days.find((candidate: any) => candidate.localDate === '2026-09-10');
    expect(day.coverIsExplicit).toBe(false);
  });
});
