import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('trip blog media quota lifecycle', () => {
  const owner = { firstName: 'Media', lastName: 'Uploader', email: 'blog-media@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
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

  it('rejects unsupported image formats before reserving bytes', async () => {
    await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'photo-heic').send({ dayDate: '2026-09-01', mediaKind: 'photo', mimeType: 'image/heic', byteSize: 2048 }).expect(400);
  });
});
