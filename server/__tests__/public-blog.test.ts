import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { randomUUID } from 'crypto';
import { futureDateString, registerAndLoginWebUser } from './helpers';
import { insertPublicAlias, insertPublicEpoch, publishUploadedAsset, setStoredVisibility } from './providerRows';

// The real client would hit GCS; here we just confirm the route calls it with the rendition
// naming convention and puts the result on the response, without exercising real storage.
jest.mock('../src/services/blogStorageClient', () => ({
  createBlogReadUrl: jest.fn(async (objectKey: string) => `https://signed.test/${objectKey}`),
  // null selects the simulated upload path, which is all a photo fixture needs.
  createBlogUploadUrl: jest.fn(async () => null),
  blogRenditionKey: (uploaderUserId: string, assetId: string, rendition: string) => `trip-blog/${uploaderUserId}/${assetId}/${rendition}`,
}));

describe('Public Blog API', () => {
  // Built through the public API (plus the few direct writes that stand in for publishing and photo
  // processing), so the same fixture works on pg-mem and on Firestore.
  const day = futureDateString();
  const expenseAmount = 7777.77;
  const expenseCategory = 'Dinner';

  beforeAll(async () => {
    await initDb();
    for (const flag of ['trip_blog', 'trip_blog_photo_uploads']) await setFeatureFlag(flag, true, null);
    const bloggerEmail = `public-blog-${randomUUID().slice(0, 8)}@example.com`;
    const { token, userId } = await registerAndLoginWebUser({ firstName: 'Public', lastName: 'Blogger', email: bloggerEmail, password: 'secret123' });
    const auth = { Authorization: `Bearer ${token}` };
    const trip = await request(app).post('/api/trips/wizard').set(auth).send({ name: 'Paris 2026', startDate: day, endDate: day, participants: [] }).expect(201);
    const tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set(auth).expect(200);
    await request(app).patch(`/api/trips/${tripId}/blog`).set(auth).send({ title: 'Paris Blog' }).expect(200);
    await request(app).patch(`/api/trips/${tripId}/blog/days/${day}`).set(auth).send({ headline: 'Arrival in Paris', updateVersion: 1 }).expect(200);
    await request(app).post(`/api/trips/${tripId}/blog/items`).set(auth).send({ kindKey: 'core.text', dayDate: day, body: 'We arrived today!', audience: 'public' }).expect(201);

    // A public photo, so the response's media-URL-signing path (attachPublicMediaUrls) is exercised.
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth).set('Idempotency-Key', `public-blog-photo-${randomUUID()}`)
      .send({ dayDate: day, mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 }).expect(201);
    // Processing (download, resize) is out of scope here: mark the asset ready as it would be.
    await publishUploadedAsset(init.body.asset.id);

    // Publish at the data layer (the consent flow has its own tests in blog-publication).
    await setStoredVisibility(tripId, 'public');
    await insertPublicEpoch(tripId, userId);
    await insertPublicAlias(tripId, userId, 'testuser', 'paris-2026');

    // An expense, which must never appear on the public page.
    const group = await request(app).get(`/api/groups`).set(auth).expect(200);
    const members = await request(app).get(`/api/groups/${group.body[0].id}/members`).set(auth).expect(200);
    const memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === bloggerEmail)?.id;
    await request(app).post('/api/expenses').set(auth).send({ tripId, expenseDate: day, category: expenseCategory, amount: expenseAmount, currency: 'USD', payerIds: [memberId], forIds: [memberId], vendor: 'Hidden vendor' }).expect(201);
  });

  it('allows anonymous access to a public blog via vanity URL', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Paris Blog');
    expect(res.body.days[0].headline).toBe('Arrival in Paris');
    expect(res.body.days[0].items[0].body).toBe('We arrived today!');
  });

  it('signs a URL for a public photo and never exposes its storage object key or uploader', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    const photoItem = res.body.days[0].items.find((item: any) => item.mediaKind === 'photo');
    expect(photoItem).toBeTruthy();
    expect(photoItem.primaryUrl).toMatch(/^https:\/\/signed\.test\//);
    expect(photoItem.thumbnailUrl).toMatch(/^https:\/\/signed\.test\//);
    expect(photoItem.objectKey).toBeUndefined();
    expect(photoItem.uploaderUserId).toBeUndefined();
  });

  it('does not expose expense or cost data in public response', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(String(expenseAmount));
    expect(json).not.toContain(expenseCategory);
    expect(json).not.toContain('Hidden vendor');
    expect(res.body.expenses).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it('returns 404 for non-existent or private blogs', async () => {
    const res = await request(app).get('/public/blog/nobody/nowhere');
    expect(res.status).toBe(404);
  });
});
