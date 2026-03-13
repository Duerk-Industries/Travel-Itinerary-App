import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';
import * as itineraryPromptPlanService from '../src/services/itineraryPromptPlanService';

const TS = Date.now();

describe('AI itinerary limits and idempotency', () => {
  let pool: Pool;
  let token: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await seedTiersForTest(pool);

    const user = await registerAndLoginWebUser(pool, {
      firstName: 'AI',
      lastName: 'Limits',
      email: `itinerary-limits-test+${TS}@example.com`,
      password: 'TestPass1!',
    });
    token = user.token;
    userId = user.userId;

    const groupResponse = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Itinerary Limit Group ${TS}` })
      .expect(201);
    const groupId = groupResponse.body.id ?? groupResponse.body.group?.id;

    const tripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Itinerary Limit Trip ${TS}`, groupId, endDate: '2099-12-31' })
      .expect(201);
    tripId = tripResponse.body.id ?? tripResponse.body.trip?.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool.query(`DELETE FROM users WHERE email LIKE 'itinerary-limits-test+%'`);
    await pool.end();
    await closePool();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const postGenerate = (idempotencyKey: string) =>
    request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        tripId,
        country: 'France',
        locations: ['Paris'],
        days: 3,
        budgetMin: 100,
        budgetMax: 500,
      });

  it('counts only successful generations toward the monthly limit', async () => {
    jest
      .spyOn(itineraryPromptPlanService, 'generateItineraryViaPromptPlan')
      .mockRejectedValueOnce(new Error('transient upstream failure'));

    await postGenerate('fail-once').expect(500);
    jest.restoreAllMocks();
    jest.spyOn(itineraryPromptPlanService, 'generateItineraryViaPromptPlan').mockResolvedValue({
      planMarkdown: '# Day 1\nArrive in Paris.',
      normalized: null,
      route: null,
      itinerary: null,
      details: [],
      generatedItems: { transfers: [], lodgings: [], activities: [], carRentals: [] },
      tokenUsage: { totalTokens: 42 },
      profile: null,
    } as any);

    const { rows: afterFailure } = await pool.query(
      `SELECT count
       FROM usage_counters
       WHERE user_id = $1 AND metric_key = 'ai_itinerary_generations' AND window_key <> 'all-time'`,
      [userId]
    );
    expect(afterFailure.length).toBe(0);

    for (let i = 0; i < 5; i += 1) {
      await postGenerate(`success-${i}`).expect(200);
    }

    const blocked = await postGenerate('success-6').expect(402);
    expect(blocked.body.code).toBe('TIER_LIMIT_REACHED');
  });

  it('reuses the same idempotency key without double-counting usage', async () => {
    jest.spyOn(itineraryPromptPlanService, 'generateItineraryViaPromptPlan').mockResolvedValue({
      planMarkdown: '# Day 1\nWalk the city.',
      normalized: null,
      route: null,
      itinerary: null,
      details: [],
      generatedItems: { transfers: [], lodgings: [], activities: [], carRentals: [] },
      tokenUsage: { totalTokens: 10 },
      profile: null,
    } as any);

    const uniqueEmail = `itinerary-limits-test+dedupe-${TS}@example.com`;
    const dedupeUser = await registerAndLoginWebUser(pool, {
      firstName: 'AI',
      lastName: 'Dedupe',
      email: uniqueEmail,
      password: 'TestPass1!',
    });
    const groupResponse = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${dedupeUser.token}`)
      .send({ name: `Dedupe Group ${TS}` })
      .expect(201);
    const groupId = groupResponse.body.id ?? groupResponse.body.group?.id;
    const tripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${dedupeUser.token}`)
      .send({ name: `Dedupe Trip ${TS}`, groupId, endDate: '2099-12-31' })
      .expect(201);
    const dedupeTripId = tripResponse.body.id ?? tripResponse.body.trip?.id;

    const sendDedupeRequest = () =>
      request(app)
        .post('/api/itinerary')
        .set('Authorization', `Bearer ${dedupeUser.token}`)
        .set('Idempotency-Key', 'same-request')
        .send({
          tripId: dedupeTripId,
          country: 'Italy',
          locations: ['Rome'],
          days: 2,
          budgetMin: 50,
          budgetMax: 300,
        });

    const first = await sendDedupeRequest().expect(200);
    const second = await sendDedupeRequest().expect(200);

    expect(second.body.plan).toBe(first.body.plan);

    const { rows } = await pool.query(
      `SELECT count
       FROM usage_counters
       WHERE user_id = $1 AND metric_key = 'ai_itinerary_generations' AND window_key <> 'all-time'`,
      [dedupeUser.userId]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].count)).toBe(1);
  });
});
