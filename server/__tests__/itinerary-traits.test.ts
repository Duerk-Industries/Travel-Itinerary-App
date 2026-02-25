import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser } from './helpers';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Itinerary generation and trait lifecycle', () => {
  let pool: Pool;
  let token: string;
  let groupId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'REDACTED';
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
    mockedAxios.post.mockReset();
  });

  it('creates and deletes a custom trait via API', async () => {
    const email = `itinerary-trait-test+${Date.now()}@example.com`;
    const login = await registerAndLoginWebUser(pool, {
      firstName: 'Trait',
      lastName: 'Tester',
      email,
      password: 'testpass1!',
    });
    token = login.token;
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
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-07-01',
                  ed: '2026-07-02',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                  tm: 'B',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'United States', ci: '2026-07-01', co: '2026-07-03', dn: [] }],
                  x: [{ dt: '2026-07-01', m: 'Train', fr: 'JFK', to: 'United States' }],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'United States', ci: '2026-07-01', co: '2026-07-03', dn: [] }],
                  x: [{ dt: '2026-07-01', m: 'Train', fr: 'JFK', to: 'United States' }],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-07-01',
                      b: 'United States',
                      it: [['M', 'R', 'Timed museum entry'], ['D', 'T', 'Guided city walk']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'United States'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 2,
                      dt: '2026-07-02',
                      b: 'United States',
                      it: [['D', 'O', 'Neighborhood exploration']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'United States'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'United States', ci: '2026-07-01', co: '2026-07-03', dn: [] }],
                  x: [{ dt: '2026-07-01', m: 'Train', fr: 'JFK', to: 'United States' }],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-07-01',
                      b: 'United States',
                      it: [['M', 'R', 'Timed museum entry'], ['D', 'T', 'Guided city walk']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'United States'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 2,
                      dt: '2026-07-02',
                      b: 'United States',
                      it: [['D', 'O', 'Neighborhood exploration']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'United States'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '## Day-by-day\n- Day 1\n- Day 2' } }],
        },
      });

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
        tt: { p: 'B', c: 'M', mob: 'M', car: 'P', w: { o: 25, c: 25, f: 20, n: 10, r: 20 }, tm: 'B' },
        ut: { i: ['Culture'], eb: false, no: false },
      })
      .expect(200);

    expect(itinRes.body.plan).toBeTruthy();
    expect(typeof itinRes.body.plan).toBe('string');
    expect(Array.isArray(itinRes.body.details)).toBe(true);
    expect(itinRes.body.generatedItems?.transfers?.[0]?.status).toBe('Needed');
    expect(itinRes.body.generatedItems?.lodgings?.[0]?.status).toBe('Needed');
    expect(itinRes.body.generatedItems?.activities?.[0]?.status).toBe('Needed');
    expect(itinRes.body.generatedItems?.activities?.[0]?.activityType).toBe('Reservation');
  });
});
