import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('Expenses API', () => {
  const uniq = Date.now();
  const user = { email: `expense+${uniq}@example.com`, firstName: 'Expense', lastName: 'Tester', password: 'testtest' };
  let token: string;
  let tripId: string;
  let groupId: string;
  let memberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();

    const login = await registerAndLoginWebUser(user);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Expense Trip ${uniq}`, groupId, currency: 'USD' })
      .expect(201);
    tripId = trip.body.id as string;

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === user.email)?.id;
    expect(memberId).toBeTruthy();
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates, lists, and deletes expenses', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        expenseDate: '2025-02-01',
        category: 'Breakfast',
        amount: 12.5,
        currency: 'USD',
        amountInTripCurrency: 12.5,
        exchangeRateToTripCurrency: 1,
        exchangeRateDate: '2025-02-01',
        payerIds: [memberId],
        forIds: [memberId],
      })
      .expect(201);
    expect(created.body.amountInTripCurrency).toBe(12.5);
    expect(created.body.exchangeRateToTripCurrency).toBe(1);
    expect(created.body.exchangeRateDate).toBe('2025-02-01');

    const list = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);

    await request(app)
      .delete(`/api/expenses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
