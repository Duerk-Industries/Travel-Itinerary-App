import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { registerAndLoginWebUser } from './helpers';

describe('Trip following (read-only)', () => {
  jest.setTimeout(60000);
  const uniq = Date.now();
  const owner = { email: `follow-owner+${uniq}@example.com`, firstName: 'Follow', lastName: 'Owner', password: 'testtest' };
  const follower = {
    email: `follow-follower+${uniq}@example.com`,
    firstName: 'Follow',
    lastName: 'Follower',
    password: 'testtest',
  };

  let ownerToken = '';
  let followerToken = '';
  let tripId = '';
  let ownerMemberId = '';
  let inviteCode = '';
  let pool: Pool;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const ownerLogin = await registerAndLoginWebUser(pool, owner);
    ownerToken = ownerLogin.token;

    const followerLogin = await registerAndLoginWebUser(pool, follower);
    followerToken = followerLogin.token;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    ownerMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id as string;
    expect(ownerMemberId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Follow Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;
    expect(tripId).toBeTruthy();

    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [ownerMemberId],
        departureDate: '2026-07-10',
        departureTime: '09:00',
        arrivalTime: '11:00',
        tripId,
        cost: 123,
        carrier: 'TestAir',
        flightNumber: 'TA123',
        bookingReference: 'ABC123',
        paidBy: [ownerMemberId],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, follower.email]);
      await pool.end();
    }
    await closePool();
  });

  it('allows follow by code and read access while blocking trip edits', async () => {
    const codeRes = await request(app)
      .get(`/api/trips/${tripId}/follow-code`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    inviteCode = codeRes.body.inviteCode as string;
    expect(inviteCode).toBeTruthy();

    const followRes = await request(app)
      .post('/api/trips/follow')
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ inviteCode });
    if (followRes.status !== 201 && followRes.status !== 200) {
      throw new Error(`Expected follow status 200/201, got ${followRes.status}: ${JSON.stringify(followRes.body)}`);
    }

    const followed = await request(app).get('/api/trips/followed').set('Authorization', `Bearer ${followerToken}`).expect(200);
    expect((followed.body as any[]).some((t: any) => t.tripId === tripId)).toBe(true);

    const trip = await request(app).get(`/api/trips/${tripId}`).set('Authorization', `Bearer ${followerToken}`).expect(200);
    expect(trip.body.id).toBe(tripId);
    expect(trip.body.access).toBe('follower');

    const flights = await request(app).get(`/api/flights?tripId=${tripId}`).set('Authorization', `Bearer ${followerToken}`).expect(200);
    expect(Array.isArray(flights.body)).toBe(true);
    expect(flights.body.length).toBeGreaterThan(0);

    await request(app)
      .patch(`/api/trips/${tripId}`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ description: 'Follower edit attempt' })
      .expect(403);
  });

  it('supports unfollow', async () => {
    await request(app).delete(`/api/trips/${tripId}/follow`).set('Authorization', `Bearer ${followerToken}`).expect(204);
    const followed = await request(app).get('/api/trips/followed').set('Authorization', `Bearer ${followerToken}`).expect(200);
    expect((followed.body as any[]).some((t: any) => t.tripId === tripId)).toBe(false);
  });

  it('allows followers and members to discuss via trip comments', async () => {
    await request(app)
      .post('/api/trips/follow')
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ inviteCode })
      .expect((res) => {
        if (res.status !== 200 && res.status !== 201) {
          throw new Error(`Expected follow status 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
      });

    const post = await request(app)
      .post(`/api/trips/${tripId}/comments`)
      .set('Authorization', `Bearer ${followerToken}`)
      .send({ body: 'Looking forward to this trip!' })
      .expect(201);
    expect(post.body.body).toContain('Looking forward');

    const commentsAsOwner = await request(app)
      .get(`/api/trips/${tripId}/comments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(Array.isArray(commentsAsOwner.body.comments)).toBe(true);
    expect(commentsAsOwner.body.comments.some((c: any) => String(c.body).includes('Looking forward'))).toBe(true);
  });
});
