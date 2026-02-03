import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';

describe('Expenses API', () => {
  const uniq = Date.now();
  const user = { email: `expense+${uniq}@example.com`, firstName: 'Expense', lastName: 'Tester', password: 'testtest' };
  let pool: Pool;
  let token: string;
  let tripId: string;
  let groupId: string;
  let memberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user.firstName, lastName: user.lastName, email: user.email, password: user.password, passwordConfirm: user.password })
      .expect(201);
    token = reg.body.token as string;

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
    await pool.end();
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
        payerIds: [memberId],
        forIds: [memberId],
      })
      .expect(201);

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
