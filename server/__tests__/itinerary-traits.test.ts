import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import fetch from 'node-fetch';

jest.mock('node-fetch');
const mockedFetch = fetch as unknown as jest.Mock;

describe('Itinerary generation and trait lifecycle', () => {
  let pool: Pool;
  let token: string;
  let groupId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email LIKE $1', ['itinerary-trait-test+%@example.com']);
      await pool.end();
    }
    await closePool();
  });

  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('creates and deletes a custom trait via API', async () => {
    const email = `itinerary-trait-test+${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({
        firstName: 'Trait',
        lastName: 'Tester',
        email,
        password: 'testpass1!',
        passwordConfirm: 'testpass1!',
      })
      .expect(201);
    token = reg.body.token;
    expect(token).toBeTruthy();

    // Create trait
    const name = `CustomTrait-${Date.now()}`;
    const createRes = await request(app)
      .post('/api/traits')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    const traitId = createRes.body?.id || createRes.body?.trait?.id;
    expect(traitId).toBeTruthy();

    // Ensure it exists
    const listAfterCreate = await request(app)
      .get('/api/traits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listAfterCreate.body.some((t: any) => t.name === name)).toBe(true);

    // Delete
    await request(app)
      .delete(`/api/traits/${traitId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const listAfterDelete = await request(app)
      .get('/api/traits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listAfterDelete.body.some((t: any) => t.name === name)).toBe(false);
  });

  it('generates an itinerary successfully', async () => {
    // Mock OpenAI response
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Day 1: Activity $100\nDay 2: Fun $150' } }],
      }),
    } as any);

    // Create group
    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Group-${Date.now()}` })
      .expect(201);
    groupId = groupRes.body?.id ?? groupRes.body?.group?.id;
    expect(groupId).toBeTruthy();

    // Create trip
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Trip-${Date.now()}`, groupId })
      .expect(201);
    tripId = tripRes.body?.id ?? tripRes.body?.trip?.id;
    expect(tripId).toBeTruthy();

    const itinRes = await request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .send({
        country: 'United States',
        days: 2,
        budgetMin: 500,
        budgetMax: 1500,
        departureAirport: 'JFK',
        tripStyle: 'Automated test',
        tripId,
        traits: [],
      })
      .expect(200);

    expect(itinRes.body.plan).toBeTruthy();
    expect(typeof itinRes.body.plan).toBe('string');
  });
});
