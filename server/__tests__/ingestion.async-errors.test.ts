/// <reference types="jest" />
/// <reference types="node" />
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const seedTiersForTest = async () => {
  const db = require('../src/db');
  for (const [key, displayName, rank] of [['free', 'Free', 1], ['premium', 'Premium', 2], ['pro', 'Pro', 3]] as const) {
    await db.upsertTier(key, displayName, rank);
  }

  const limits: Array<[string, string, number]> = [
    ['free', 'max_active_trips', 3],
    ['free', 'max_travelers_per_trip', 6],
    ['free', 'ai_itinerary_generations_per_month', 5],
    ['premium', 'max_active_trips', 250],
    ['premium', 'max_travelers_per_trip', 200],
    ['premium', 'ai_itinerary_generations_per_month', -1],
    ['pro', 'max_active_trips', 250],
    ['pro', 'max_travelers_per_trip', 200],
    ['pro', 'ai_itinerary_generations_per_month', -1],
  ];
  for (const [tierKey, limitKey, limitValue] of limits) {
    const tier = await db.getTierByKey(tierKey);
    if (!tier) continue;
    await db.upsertTierLimit(tier.id, limitKey, limitValue);
  }

  const features: Array<[string, string, boolean]> = [
    ['ai_itinerary_generation', 'AI-powered itinerary generation', true],
    ['csv_export', 'Export cost reports as CSV', true],
    ['car_rentals', 'Car rental tracking', true],
    ['trip_sharing', 'Share trips with other users', true],
    ['trip_following', 'Follow trips as read-only observer', true],
    ['cost_tracking', 'Expense and cost tracking', true],
    ['multiple_groups', 'Create more than one group', true],
    ['trip_creation', 'Create new trips', true],
  ];
  for (const [key, description, defaultEnabled] of features) {
    await db.upsertFeature(key, description, defaultEnabled);
  }

  const entitlements: Array<[string, string, boolean]> = [
    ['free', 'ai_itinerary_generation', true],
    ['free', 'csv_export', true],
    ['free', 'car_rentals', true],
    ['free', 'trip_sharing', true],
    ['free', 'trip_following', true],
    ['free', 'cost_tracking', false],
    ['free', 'multiple_groups', true],
    ['free', 'trip_creation', true],
    ['premium', 'cost_tracking', true],
    ['pro', 'cost_tracking', true],
  ];
  const allFeatures = await db.listFeatures();
  for (const [tierKey, featureKey, isAllowed] of entitlements) {
    const tier = await db.getTierByKey(tierKey);
    const feature = allFeatures.find((entry: any) => entry.key === featureKey);
    if (!tier || !feature) continue;
    await db.upsertTierEntitlement(tier.id, feature.id, isAllowed);
  }
};

describe('ingestion async errors', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db');
    await db.initDb();
    await seedTiersForTest();
  });

  it('returns a fast 500 when the jobs repository throws instead of hanging the request', async () => {
    jest.doMock('../src/ingestion/shared/repository', () => {
      const actual = jest.requireActual('../src/ingestion/shared/repository');
      return {
        ...actual,
        listImportJobsForUser: jest.fn(async () => {
          throw Object.assign(new Error('Synthetic Firestore failure'), { statusCode: 500 });
        }),
      };
    });

    const request = require('supertest');
    const { app } = require('../src/app');
    const db = require('../src/db');

    const user = {
      firstName: 'Jobs',
      lastName: 'Failure',
      email: 'jobs-failure@example.com',
      password: 'secret123',
    };

    await request(app)
      .post('/api/web-auth/register')
      .send({ ...user, passwordConfirm: user.password })
      .expect(201);

    const found = await db.findUserByEmail(user.email);
    expect(found).toBeTruthy();
    const verification = await db.createEmailVerification(found.id);
    await request(app)
      .get('/api/web-auth/confirm')
      .query({ token: verification.token })
      .expect(200);

    const login = await request(app)
      .post('/api/web-auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    await db.setUserTier(found.id, 'premium', 'admin_override', null, 'test setup');

    const startedAt = Date.now();
    const res = await request(app)
      .get('/api/ingestion/jobs')
      .set({ Authorization: `Bearer ${login.body.token}` })
      .expect(500);

    expect(res.body).toEqual({ error: 'Internal server error.' });
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
