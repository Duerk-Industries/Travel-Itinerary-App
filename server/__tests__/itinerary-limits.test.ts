import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, getUsageCounter } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, cleanupTestUsersByEmail } from './helpers';
import * as itineraryPromptPlanService from '../src/services/itineraryPromptPlanService';

const TS = Date.now();

/** Returns the current UTC monthly window key, e.g. "2026-03" */
const getMonthWindowKey = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

describe('AI itinerary limits and idempotency', () => {
  let token: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    await initDb();
    await seedTiersForTest();

    const user = await registerAndLoginWebUser({
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
    await cleanupTestUsersByEmail([`itinerary-limits-test+${TS}@example.com`]);
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

    const monthlyCount = await getUsageCounter(userId, 'ai_itinerary_generations', getMonthWindowKey());
    expect(monthlyCount).toBe(0);

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
    const dedupeUser = await registerAndLoginWebUser({
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

    const monthlyCount = await getUsageCounter(dedupeUser.userId, 'ai_itinerary_generations', getMonthWindowKey());
    expect(monthlyCount).toBe(1);
  });

  it('passes the reserved monthly usage window into async generation jobs', async () => {
    const asyncEmail = `itinerary-limits-test+async-${TS}@example.com`;
    const asyncUser = await registerAndLoginWebUser({
      firstName: 'AI',
      lastName: 'Async',
      email: asyncEmail,
      password: 'TestPass1!',
    });
    const asyncGroupResponse = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${asyncUser.token}`)
      .send({ name: `Async Group ${TS}` })
      .expect(201);
    const asyncGroupId = asyncGroupResponse.body.id ?? asyncGroupResponse.body.group?.id;
    const asyncTripResponse = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${asyncUser.token}`)
      .send({ name: `Async Trip ${TS}`, groupId: asyncGroupId, endDate: '2099-12-31' })
      .expect(201);
    const asyncTripId = asyncTripResponse.body.id ?? asyncTripResponse.body.trip?.id;

    const promptPlanSpy = jest.spyOn(itineraryPromptPlanService, 'generateItineraryViaPromptPlan').mockResolvedValue({
      planMarkdown: '# Day 1\nWalk the city.',
      normalized: null,
      route: null,
      itinerary: null,
      details: [],
      generatedItems: { transfers: [], lodgings: [], activities: [], carRentals: [] },
      tokenUsage: { totalTokens: 10 },
      profile: null,
    } as any);

    const res = await request(app)
      .post('/api/itinerary/async')
      .set('Authorization', `Bearer ${asyncUser.token}`)
      .set('Idempotency-Key', 'async-window')
      .send({
        tripId: asyncTripId,
        country: 'France',
        locations: ['Paris'],
        days: 3,
        budgetMin: 100,
        budgetMax: 500,
      })
      .expect(202);

    expect(res.body.jobId).toBeTruthy();
    for (let attempt = 0; attempt < 20 && !promptPlanSpy.mock.calls.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(promptPlanSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: asyncUser.userId,
        tripIdSeed: asyncTripId,
        usageWindowKey: getMonthWindowKey(),
      })
    );

    await cleanupTestUsersByEmail([asyncEmail]);
  });
});
