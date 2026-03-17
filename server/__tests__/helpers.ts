import request from 'supertest';
import { app } from '../src/app';
import {
  createEmailVerification,
  findUserByEmail,
  getTierByKey,
  setUserRole,
  setUserTier,
  upsertTier,
  upsertFeature,
  upsertTierLimit,
  upsertTierEntitlement,
  listFeatures,
} from '../src/db';

export type TestUser = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

export const registerWebUser = async (user: TestUser) => {
  return request(app)
    .post('/api/web-auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmWebUser = async (email: string) => {
  const found = await findUserByEmail(email);
  if (!found) throw new Error(`Unable to find user for ${email}`);
  const userId = found.id;
  const verification = await createEmailVerification(userId);
  await request(app)
    .get('/api/web-auth/confirm')
    .query({ token: verification.token })
    .expect(200);
  return userId;
};

export const loginWebUser = async (user: TestUser) => {
  return request(app)
    .post('/api/web-auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
};

export const registerAndLoginWebUser = async (user: TestUser) => {
  await registerWebUser(user);
  const userId = await confirmWebUser(user.email);
  const login = await loginWebUser(user);
  return { token: login.body.token as string, userId };
};

export const registerDeviceUser = async (user: TestUser) => {
  return request(app)
    .post('/api/auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmDeviceUser = async (email: string) => {
  const found = await findUserByEmail(email);
  if (!found) throw new Error(`Unable to find user for ${email}`);
  const userId = found.id;
  const verification = await createEmailVerification(userId);
  await request(app)
    .get('/api/auth/confirm')
    .query({ token: verification.token })
    .expect(200);
  return userId;
};

export const loginDeviceUser = async (user: TestUser) => {
  return request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
};

export const registerAndLoginDeviceUser = async (user: TestUser) => {
  await registerDeviceUser(user);
  const userId = await confirmDeviceUser(user.email);
  const login = await loginDeviceUser(user);
  return { token: login.body.token as string, userId };
};

/**
 * Registers and confirms a user, grants them the admin role via the db facade,
 * then re-logs in so the returned token carries role='admin'.
 */
export const makeAdminUser = async (user: TestUser): Promise<{ token: string; userId: string }> => {
  const { userId } = await registerAndLoginWebUser(user);
  await setUserRole(userId, 'admin');
  const relogin = await loginWebUser(user);
  return { token: relogin.body.token as string, userId };
};

/**
 * Assigns a tier to a user via the db facade (closes any existing active tier row first).
 * Requires the tier to already exist in the `tiers` table.
 */
export const setUserTierInDb = async (userId: string, tierKey: string): Promise<void> => {
  await setUserTier(userId, tierKey, 'admin_override', null, 'test setup');
};

/**
 * Ensures base tier seed data (tiers + tier_limits + features + entitlements) is present.
 * Call in beforeAll for tests that rely on tier/entitlement data.
 */
export const seedTiersForTest = async (): Promise<void> => {
  for (const [key, displayName, rank] of [['free', 'Free', 1], ['premium', 'Premium', 2], ['pro', 'Pro', 3]] as const) {
    await upsertTier(key, displayName, rank);
  }

  const limits: Array<[string, string, number]> = [
    ['free',    'max_active_trips',                   3],
    ['free',    'max_travelers_per_trip',              6],
    ['free',    'ai_itinerary_generations_per_month',  5],
    ['premium', 'max_active_trips',                   250],
    ['premium', 'max_travelers_per_trip',              200],
    ['premium', 'ai_itinerary_generations_per_month', -1],
    ['pro',     'max_active_trips',                   250],
    ['pro',     'max_travelers_per_trip',              200],
    ['pro',     'ai_itinerary_generations_per_month', -1],
  ];
  for (const [tierKey, limitKey, limitValue] of limits) {
    const tier = await getTierByKey(tierKey);
    if (!tier) continue;
    await upsertTierLimit(tier.id, limitKey, limitValue);
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
    await upsertFeature(key, description, defaultEnabled);
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
  const allFeatures = await listFeatures();
  for (const [tierKey, featureKey, isAllowed] of entitlements) {
    const tier = await getTierByKey(tierKey);
    const feature = allFeatures.find(f => f.key === featureKey);
    if (!tier || !feature) continue;
    await upsertTierEntitlement(tier.id, feature.id, isAllowed);
  }
};

/**
 * Finds users by email and deletes them using the db facade.
 * Safely handles non-existent users.
 */
export const cleanupTestUsersByEmail = async (emails: string[]): Promise<void> => {
  for (const email of emails) {
    const user = await findUserByEmail(email);
    if (user) {
      const { deleteWebUserAndCleanup } = await import('../src/db');
      await deleteWebUserAndCleanup(user.id);
    }
  }
};

export const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 50): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for test condition.');
};
