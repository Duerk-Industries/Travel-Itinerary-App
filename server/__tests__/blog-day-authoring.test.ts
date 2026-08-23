import request from 'supertest';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';

// Phase 1 of docs/trip-blog-social-implementation-plan.md (A3/A4): headline/summary editing
// with optimistic concurrency (architecture §4.05, FR-A3.3), and masthead editing.
describe('trip blog day and masthead authoring', () => {
  const owner = { firstName: 'Author', lastName: 'Owner', email: 'blog-day-authoring-owner@example.com', password: 'Password123!' };
  const outsider = { firstName: 'Author', lastName: 'Outsider', email: 'blog-day-authoring-outsider@example.com', password: 'Password123!' };
  let token = '';
  let outsiderToken = '';
  let tripId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    token = (await loginWebUser(owner)).body.token;
    await registerWebUser(outsider);
    await confirmWebUser(outsider.email);
    outsiderToken = (await loginWebUser(outsider)).body.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${token}`).send({ name: 'Authoring Trip', startDate: '2026-09-10', endDate: '2026-09-12', participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
  });
  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, outsider.email]); });

  const getDay = async (dayDate: string) => {
    const blog = await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);
    return blog.body.days.find((candidate: any) => candidate.localDate === dayDate);
  };

  it('sets a day headline and summary, and returns an incremented updateVersion', async () => {
    const before = await getDay('2026-09-10');
    expect(before.updateVersion).toBe(1);
    const res = await request(app)
      .patch(`/api/trips/${tripId}/blog/days/2026-09-10`)
      .set('Authorization', `Bearer ${token}`)
      .send({ headline: 'Lost in Trastevere', summary: 'A day we planned badly and enjoyed anyway.', updateVersion: 1 })
      .expect(200);
    expect(res.body.headline).toBe('Lost in Trastevere');
    expect(res.body.summary).toBe('A day we planned badly and enjoyed anyway.');
    expect(res.body.updateVersion).toBe(2);
    const after = await getDay('2026-09-10');
    expect(after.headline).toBe('Lost in Trastevere');
    expect(after.updateVersion).toBe(2);
  });

  it('leaves an omitted field unchanged', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog/days/2026-09-11`).set('Authorization', `Bearer ${token}`).send({ headline: 'Day two', updateVersion: 1 }).expect(200);
    const res = await request(app).patch(`/api/trips/${tripId}/blog/days/2026-09-11`).set('Authorization', `Bearer ${token}`).send({ summary: 'Added later', updateVersion: 2 }).expect(200);
    expect(res.body.headline).toBe('Day two');
    expect(res.body.summary).toBe('Added later');
  });

  it('rejects a stale updateVersion with 409 VERSION_CONFLICT and the latest state', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog/days/2026-09-12`).set('Authorization', `Bearer ${token}`).send({ headline: 'First writer', updateVersion: 1 }).expect(200);
    const res = await request(app)
      .patch(`/api/trips/${tripId}/blog/days/2026-09-12`)
      .set('Authorization', `Bearer ${token}`)
      .send({ headline: 'Stale writer', updateVersion: 1 })
      .expect(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');
    expect(res.body.latest.headline).toBe('First writer');
    expect(res.body.latest.updateVersion).toBe(2);
  });

  it('rejects a headline over 120 characters', async () => {
    await request(app)
      .patch(`/api/trips/${tripId}/blog/days/2026-09-10`)
      .set('Authorization', `Bearer ${token}`)
      .send({ headline: 'x'.repeat(121), updateVersion: 2 })
      .expect(400);
  });

  it('denies a user outside the trip', async () => {
    await request(app)
      .patch(`/api/trips/${tripId}/blog/days/2026-09-10`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ headline: 'Should not land', updateVersion: 2 })
      .expect(403);
  });

  it('edits the blog masthead and leaves omitted fields unchanged', async () => {
    const res = await request(app)
      .patch(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Our Italy Trip', subtitle: 'Twelve days, four cities' })
      .expect(200);
    expect(res.body.title).toBe('Our Italy Trip');
    expect(res.body.subtitle).toBe('Twelve days, four cities');
    const second = await request(app)
      .patch(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${token}`)
      .send({ introduction: 'Written after the fact, mostly accurately.' })
      .expect(200);
    expect(second.body.title).toBe('Our Italy Trip');
    expect(second.body.introduction).toBe('Written after the fact, mostly accurately.');
  });

  it('denies masthead edits from a user outside the trip', async () => {
    await request(app)
      .patch(`/api/trips/${tripId}/blog`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ title: 'Hijacked' })
      .expect(403);
  });
});
