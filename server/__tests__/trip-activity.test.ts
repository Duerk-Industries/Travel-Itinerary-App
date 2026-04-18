import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, writeActivity } from '../src/db';
import { registerAndLoginWebUser, cleanupTestUsersByEmail } from './helpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Trip activity feed', () => {
  jest.setTimeout(60000);
  const uniq = Date.now();
  const owner = { email: `activity-owner+${uniq}@example.com`, firstName: 'Activity', lastName: 'Owner', password: 'testtest' };
  const follower = { email: `activity-follower+${uniq}@example.com`, firstName: 'Activity', lastName: 'Follower', password: 'testtest' };
  const outsider = { email: `activity-outsider+${uniq}@example.com`, firstName: 'Activity', lastName: 'Outsider', password: 'testtest' };

  let ownerToken = '';
  let followerToken = '';
  let outsiderToken = '';
  let ownerUserId = '';
  let tripId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();

    const ownerLogin = await registerAndLoginWebUser(owner);
    ownerToken = ownerLogin.token;
    ownerUserId = ownerLogin.userId;

    const followerLogin = await registerAndLoginWebUser(follower);
    followerToken = followerLogin.token;

    const outsiderLogin = await registerAndLoginWebUser(outsider);
    outsiderToken = outsiderLogin.token;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const groupId = groups.body[0]?.id as string;

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Activity Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;

    const codeRes = await request(app)
      .get(`/api/trips/${tripId}/follow-code`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const inviteCode = codeRes.body.inviteCode as string;

    await request(app)
      .post('/api/trips/follow')
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ inviteCode })
      .expect((res) => {
        if (res.status !== 200 && res.status !== 201) {
          throw new Error(`unexpected follow status: ${res.status}`);
        }
      });
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, follower.email, outsider.email]);
    await closePool();
  });

  it('allows owner/follower to read activity and blocks outsiders', async () => {
    await request(app).get(`/api/trips/${tripId}/activity`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await request(app).get(`/api/trips/${tripId}/activity`).set('Authorization', `Bearer ${followerToken}`).expect(200);
    await request(app).get(`/api/trips/${tripId}/activity`).set('Authorization', `Bearer ${outsiderToken}`).expect(403);
  });

  it('supports cursor pagination using created_at + id', async () => {
    await writeActivity(tripId, ownerUserId, 'NOTE_ADDED', 'Note 1', 'First note', { index: 1 });
    await sleep(5);
    await writeActivity(tripId, ownerUserId, 'NOTE_ADDED', 'Note 2', 'Second note', { index: 2 });
    await sleep(5);
    await writeActivity(tripId, ownerUserId, 'NOTE_ADDED', 'Note 3', 'Third note', { index: 3 });

    const page1 = await request(app)
      .get(`/api/trips/${tripId}/activity`)
      .query({ limit: 2, group: 'false' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(page1.body.tripId).toBe(tripId);
    expect(Array.isArray(page1.body.events)).toBe(true);
    expect(page1.body.events.length).toBe(2);
    expect(typeof page1.body.nextCursor).toBe('string');
    expect(page1.body.events[0].createdAt >= page1.body.events[1].createdAt).toBe(true);

    const page2 = await request(app)
      .get(`/api/trips/${tripId}/activity`)
      .query({ limit: 2, cursor: page1.body.nextCursor, group: 'false' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(Array.isArray(page2.body.events)).toBe(true);
    expect(page2.body.events.length).toBeGreaterThanOrEqual(1);
    expect(page2.body.events[0].id).not.toBe(page1.body.events[0].id);
  });
});
