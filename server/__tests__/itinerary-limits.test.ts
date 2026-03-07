/**
 * Tests for AI itinerary generation limit enforcement at the route level.
 *
 * Uses jest.spyOn to mock entitlementService checks so tests are independent of pg-mem
 * seed data visibility. Verifies that the itinerary generation route correctly handles
 * EntitlementError (402) and feature-disabled (402/403) scenarios.
 */
import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser } from './helpers';
import * as entitlementService from '../src/services/entitlementService';
import * as itineraryPromptPlanService from '../src/services/itineraryPromptPlanService';
import { EntitlementError } from '../src/errors';

const TS = Date.now();
const BASE_EMAIL = `gen-limit-test+${TS}`;

describe('AI generation limit enforcement', () => {
  let pool: Pool;
  let token: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'REDACTED';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const result = await registerAndLoginWebUser(pool, {
      firstName: 'Gen',
      lastName: 'Tester',
      email: `${BASE_EMAIL}@example.com`,
      password: 'TestPass1!',
    });
    token = result.token;

    // Create group and trip
    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Gen Test Group ${TS}` })
      .expect(201);
    const groupId = groupRes.body.id ?? groupRes.body.group?.id;

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Gen Test Trip ${TS}`, groupId })
      .expect(201);
    tripId = tripRes.body.id ?? tripRes.body.trip?.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`gen-limit-test+%`]);
    await pool.end();
    await closePool();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('allows generation when under the monthly limit', async () => {
    jest.spyOn(entitlementService, 'assertAndIncrementGenerationCount').mockResolvedValue(undefined);
    jest.spyOn(entitlementService, 'assertCanUseFeature').mockResolvedValue(undefined);
    jest.spyOn(itineraryPromptPlanService, 'generateItineraryViaPromptPlan').mockResolvedValue({
      planMarkdown: '# Day 1\nArrive in Paris.',
      normalized: null,
      route: null,
      itinerary: null,
      details: [],
      generatedItems: { transfers: [], lodgings: [], activities: [], carRentals: [] },
      tokenUsage: { totalTokens: 0 },
      profile: null,
    } as any);

    const res = await request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, country: 'France', locations: ['Paris'], days: 3, budgetMin: 100, budgetMax: 500 });

    // 200 success (with mocked generation result)
    expect(res.status).toBe(200);
  });

  it('returns 402 when the monthly generation limit is reached', async () => {
    jest.spyOn(entitlementService, 'assertAndIncrementGenerationCount').mockRejectedValue(
      new EntitlementError(
        'TIER_LIMIT_REACHED',
        'You have reached the AI itinerary generation limit of 5 for this month',
        { limitKey: 'ai_itinerary_generations_per_month' },
      ),
    );
    jest.spyOn(entitlementService, 'assertCanUseFeature').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, country: 'France', locations: ['Paris'], days: 3, budgetMin: 100, budgetMax: 500 })
      .expect(402);

    expect(res.body.code).toBe('TIER_LIMIT_REACHED');
  });

  it('returns 402 when the feature flag is disabled', async () => {
    jest.spyOn(entitlementService, 'assertCanUseFeature').mockRejectedValue(
      new EntitlementError('FEATURE_DISABLED', "Feature 'ai_itinerary_generation' is currently disabled", {
        featureKey: 'ai_itinerary_generation',
      }),
    );

    const res = await request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, country: 'France', locations: ['Paris'], days: 3, budgetMin: 100, budgetMax: 500 })
      .expect(402);

    expect(res.body.code).toBe('FEATURE_DISABLED');
  });

  it('returns 402 when tier does not include the feature', async () => {
    jest.spyOn(entitlementService, 'assertCanUseFeature').mockRejectedValue(
      new EntitlementError('FEATURE_NOT_ENTITLED', 'Your plan does not include AI itinerary generation', {
        featureKey: 'ai_itinerary_generation',
      }),
    );

    const res = await request(app)
      .post('/api/itinerary')
      .set('Authorization', `Bearer ${token}`)
      .send({ tripId, country: 'France', locations: ['Paris'], days: 3, budgetMin: 100, budgetMax: 500 })
      .expect(402);

    expect(res.body.code).toBe('FEATURE_NOT_ENTITLED');
  });
});
