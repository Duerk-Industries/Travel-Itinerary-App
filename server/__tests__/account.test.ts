import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb } from '../src/db';

describe('Account lifecycle API', () => {
  const email = 'testuser@gmail.com';
  const password = 'testtest';
  let pool: Pool;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Ensure a clean slate for the test account.
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email = $1', [email]);
      await pool.end();
    }
  });

  it('creates, exercises, and deletes an account plus its solo trip', async () => {
    const registerRes = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: 'Test', lastName: 'User', email, password })
      .expect(201);

    const token = registerRes.body.token as string;
    expect(typeof token).toBe('string');

    const groupsRes = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(groupsRes.body)).toBe(true);
    const groupId = groupsRes.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Trip', groupId })
      .expect(201);

    const tripId = tripRes.body.id as string;
    expect(tripId).toBeTruthy();

    await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`).expect(204);

    const userCheck = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    expect(userCheck.rowCount).toBe(0);

    const tripCheck = await pool.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    expect(tripCheck.rowCount).toBe(0);
  });
});
