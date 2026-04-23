import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

const todayStr = (): string => new Date().toISOString().slice(0, 10);
const tomorrowStr = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

describe('Payments API', () => {
  const uniq = Date.now();
  const owner = { email: `payments+${uniq}@example.com`, firstName: 'Pay', lastName: 'Tester', password: 'testtest' };
  const other = { email: `payments-other+${uniq}@example.com`, firstName: 'Other', lastName: 'Tester', password: 'testtest' };

  let token: string;
  let otherToken: string;
  let tripId: string;
  let groupId: string;
  let memberId: string;
  let otherMemberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();

    const login = await registerAndLoginWebUser(owner);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');

    const otherLogin = await registerAndLoginWebUser(other);
    otherToken = otherLogin.token;
    await setUserTierInDb(otherLogin.userId, 'premium');

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Payment Trip ${uniq}`, groupId, currency: 'USD' })
      .expect(201);
    tripId = trip.body.id as string;

    // Invite the second user to the group by creating a guest member for them
    // (simplest path: use /api/groups/:id/members if it exists, otherwise add a guest placeholder)
    const addMember = await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ guestName: 'Second Traveler', email: other.email });
    // Accept 200 or 201 depending on the route
    expect([200, 201].includes(addMember.status)).toBe(true);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    otherMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === other.email)?.id;
    expect(memberId).toBeTruthy();
    expect(otherMemberId).toBeTruthy();
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates, lists, and deletes a payment', async () => {
    const created = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: todayStr(),
        amountCents: 2500,
      })
      .expect(201);
    expect(created.body.amountCents).toBe(2500);
    expect(created.body.payerId).toBe(memberId);
    expect(created.body.receiverId).toBe(otherMemberId);
    expect(created.body.paymentDate).toBe(todayStr());

    const list = await request(app)
      .get(`/api/payments?tripId=${tripId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].amountCents).toBe(2500);

    await request(app)
      .delete(`/api/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('accepts decimal amount and converts to integer cents', async () => {
    const created = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: todayStr(),
        amount: 12.34,
      })
      .expect(201);
    expect(created.body.amountCents).toBe(1234);
    await request(app).delete(`/api/payments/${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(204);
  });

  it('rejects future-dated payments', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: tomorrowStr(),
        amountCents: 1000,
      })
      .expect(400);
    expect(res.body.error).toMatch(/future/i);
  });

  it('rejects when payer equals receiver', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: memberId,
        paymentDate: todayStr(),
        amountCents: 1000,
      })
      .expect(400);
    expect(res.body.error).toMatch(/different/i);
  });

  it('rejects zero amount', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: todayStr(),
        amountCents: 0,
      })
      .expect(400);
    expect(res.body.error).toMatch(/greater than zero/i);
  });

  it('rejects negative amount', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: todayStr(),
        amountCents: -500,
      })
      .expect(400);
    expect(res.body.error).toMatch(/greater than zero/i);
  });

  it('rejects missing required fields', async () => {
    await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, paymentDate: todayStr(), amountCents: 100 })
      .expect(400);
  });

  it('rejects payer or receiver who is not a trip member', async () => {
    const strangerId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: strangerId,
        paymentDate: todayStr(),
        amountCents: 100,
      })
      .expect(400);
    expect(res.body.error).toMatch(/trip member/i);
  });

  it('requires authentication for list and post', async () => {
    await request(app).get(`/api/payments?tripId=${tripId}`).expect(401);
    await request(app)
      .post('/api/payments')
      .send({ tripId, payerId: memberId, receiverId: otherMemberId, paymentDate: todayStr(), amountCents: 1 })
      .expect(401);
  });

  it('rejects list without tripId', async () => {
    await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects unauthorized deletion from a user outside the trip', async () => {
    const created = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        payerId: memberId,
        receiverId: otherMemberId,
        paymentDate: todayStr(),
        amountCents: 333,
      })
      .expect(201);

    const outsider = {
      email: `payments-outsider+${Date.now()}@example.com`,
      firstName: 'Out',
      lastName: 'Sider',
      password: 'testtest',
    };
    const outsiderLogin = await registerAndLoginWebUser(outsider);
    await setUserTierInDb(outsiderLogin.userId, 'premium');
    await request(app)
      .delete(`/api/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${outsiderLogin.token}`)
      .expect(400);

    // Cleanup
    await request(app).delete(`/api/payments/${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(204);
  });

  it('allows duplicate payments', async () => {
    const sharedBody = {
      tripId,
      payerId: memberId,
      receiverId: otherMemberId,
      paymentDate: todayStr(),
      amountCents: 444,
    };
    const first = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(sharedBody)
      .expect(201);
    const second = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(sharedBody)
      .expect(201);
    expect(first.body.id).not.toBe(second.body.id);
    await request(app).delete(`/api/payments/${first.body.id}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).delete(`/api/payments/${second.body.id}`).set('Authorization', `Bearer ${token}`).expect(204);
  });
});
