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
});
