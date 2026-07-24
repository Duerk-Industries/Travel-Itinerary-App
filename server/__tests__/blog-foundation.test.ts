import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

describe('trip blog foundation', () => {
  const owner = { firstName: 'Blog', lastName: 'Author', email: 'blog-foundation@example.com', password: 'Password123!' };
  let token = '';
  let tripId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('itinerary_item_kinds', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Blog Trip', startDate: '2026-08-01', endDate: '2026-08-02', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email]);
  });

  it('creates and reads Unicode text items by day', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dayDate: '2026-08-01', body: '北京 🐰 مرحبا', languageTag: 'zh-Hans' })
      .expect(201);
    expect(created.body.body).toContain('北京');
    const read = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(read.body.days[0].items[0].body).toContain('مرحبا');
  });

  it('rejects stale optimistic updates', async () => {
    const created = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dayDate: '2026-08-02', body: 'First version' })
      .expect(201);
    await request(app)
      .patch(`/api/trips/${tripId}/blog/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: created.body.version, body: 'Updated' })
      .expect(200);
    await request(app)
      .patch(`/api/trips/${tripId}/blog/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: created.body.version, body: 'Stale' })
      .expect(409);
  });

  it('projects trip notes and locations, then detaches after a blog edit', async () => {
    const itinerary = await request(app)
      .post('/api/itineraries')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, destination: 'Museum City', days: 2 })
      .expect(201);
    const detail = await request(app)
      .post(`/api/itineraries/${itinerary.body.id}/details`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 1, kind: 'note', activity: 'Museum visit', noteBody: 'Bring tickets' })
      .expect(201);
    const location = await request(app)
      .post(`/api/itineraries/${itinerary.body.id}/details`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 1, kind: 'place', activity: 'Museum of Art', noteBody: 'North entrance' })
      .expect(201);

    let blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const linked = blog.body.days[0].items.find((item: any) => item.sourceId === detail.body.id);
    expect(linked.body).toBe('Bring tickets');
    expect(blog.body.days[0].items.find((item: any) => item.sourceId === location.body.id).body).toContain('Location: Museum of Art');

    await request(app)
      .put(`/api/itineraries/details/${detail.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activity: 'Museum visit', noteBody: 'Bring tickets and passport' })
      .expect(200);
    blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const synced = blog.body.days[0].items.find((item: any) => item.sourceId === detail.body.id);
    expect(synced.body).toBe('Bring tickets and passport');

    await request(app)
      .patch(`/api/trips/${tripId}/blog/items/${synced.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: synced.version, body: 'Blog-specific wording' })
      .expect(200);
    await request(app)
      .put(`/api/itineraries/details/${detail.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activity: 'Museum visit', noteBody: 'Trip-page wording' })
      .expect(200);
    blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    const detached = blog.body.days[0].items.find((item: any) => item.id === synced.id);
    expect(detached.body).toBe('Blog-specific wording');
    expect(detached.sourceDetached).toBe(true);

    await request(app)
      .delete(`/api/trips/${tripId}/blog/items/${synced.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: detached.version })
      .expect(204);
    blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(blog.body.days[0].items.some((item: any) => item.id === synced.id)).toBe(false);
  });
});
