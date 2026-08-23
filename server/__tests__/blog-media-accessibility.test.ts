import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

describe('trip blog media accessibility', () => {
  const traveler = { firstName: 'Alt', lastName: 'Traveler', email: 'blog-alt-traveler@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';
  let assetId = '';

  beforeAll(async () => {
    await initDb();
    for (const key of ['trip_blog', 'trip_blog_photo_uploads', 'trip_blog_public_sharing', 'trip_blog_alt_text', 'trip_blog_caption_ai']) await setFeatureFlag(key, true, null);
    clearFeatureFlagCacheForTesting();
    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    token = (await loginWebUser(traveler)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Accessible Blog', startDate: '2027-07-01', endDate: '2027-07-01', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'alt-photo-1').send({ dayDate: '2027-07-01', mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 }).expect(201);
    assetId = init.body.asset.id;
    await request(app).post(`/api/trips/${tripId}/blog/media/${assetId}/complete`).set('Authorization', `Bearer ${token}`).send({ physicalBytes: 1024 }).expect(200);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email]); });

  it('lets a Basic traveler save manual caption and alt text', async () => {
    const updated = await request(app).patch(`/api/trips/${tripId}/blog/media/${assetId}/metadata`).set('Authorization', `Bearer ${token}`)
      .send({ caption: 'A lakeside pause', altText: 'Two backpacks beside a calm lake', isDecorative: false }).expect(200);
    expect(updated.body).toEqual(expect.objectContaining({ caption: 'A lakeside pause', altText: 'Two backpacks beside a calm lake', isDecorative: false }));
  });

  it('rejects contradictory decorative metadata', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog/media/${assetId}/metadata`).set('Authorization', `Bearer ${token}`)
      .send({ altText: 'A lake', isDecorative: true }).expect(400);
  });

  it('keeps AI caption generation behind the Premium/Pro entitlement', async () => {
    const response = await request(app).post(`/api/trips/${tripId}/blog/media/${assetId}/suggest-caption`).set('Authorization', `Bearer ${token}`).expect(402);
    expect(response.body).toEqual(expect.objectContaining({ code: 'CAPTION_QUOTA_OR_TIER' }));
  });

  it('blocks public publication until every public photo is accessible', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog/media/${assetId}/metadata`).set('Authorization', `Bearer ${token}`)
      .send({ caption: '', altText: '', isDecorative: false }).expect(200);
    const blocked = await request(app).post(`/api/trips/${tripId}/blog/publication/request`).set('Authorization', `Bearer ${token}`).expect(422);
    expect(blocked.body).toEqual(expect.objectContaining({ code: 'ALT_TEXT_REQUIRED' }));

    await request(app).patch(`/api/trips/${tripId}/blog/media/${assetId}/metadata`).set('Authorization', `Bearer ${token}`)
      .send({ caption: '', altText: '', isDecorative: true }).expect(200);
    const afterFix = await request(app).post(`/api/trips/${tripId}/blog/publication/request`).set('Authorization', `Bearer ${token}`);
    expect(afterFix.status).not.toBe(422);
    await request(app).patch(`/api/trips/${tripId}/blog/media/${assetId}/metadata`).set('Authorization', `Bearer ${token}`)
      .send({ altText: 'This would contradict the saved decorative mark' }).expect(400);
  });
});
