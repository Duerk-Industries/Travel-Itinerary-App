import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { createEmailVerification } from '../src/db';

export type TestUser = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

const fetchUserIdByEmail = async (pool: Pool, email: string): Promise<string> => {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = rows[0]?.id as string | undefined;
  if (!userId) {
    throw new Error(`Unable to find user id for ${email}`);
  }
  return userId;
};

export const registerWebUser = async (user: TestUser) => {
  return request(app)
    .post('/api/web-auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmWebUser = async (pool: Pool, email: string) => {
  const userId = await fetchUserIdByEmail(pool, email);
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

export const registerAndLoginWebUser = async (pool: Pool, user: TestUser) => {
  await registerWebUser(user);
  const userId = await confirmWebUser(pool, user.email);
  const login = await loginWebUser(user);
  return { token: login.body.token as string, userId };
};

export const registerDeviceUser = async (user: TestUser) => {
  return request(app)
    .post('/api/auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmDeviceUser = async (pool: Pool, email: string) => {
  const userId = await fetchUserIdByEmail(pool, email);
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

export const registerAndLoginDeviceUser = async (pool: Pool, user: TestUser) => {
  await registerDeviceUser(user);
  const userId = await confirmDeviceUser(pool, user.email);
  const login = await loginDeviceUser(user);
  return { token: login.body.token as string, userId };
};

/**
 * Registers and confirms a user, grants them the admin role directly via SQL,
 * then re-logs in so the returned token carries role='admin'.
 */
export const makeAdminUser = async (pool: Pool, user: TestUser): Promise<{ token: string; userId: string }> => {
  const { userId } = await registerAndLoginWebUser(pool, user);
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
  const relogin = await loginWebUser(user);
  return { token: relogin.body.token as string, userId };
};

/**
 * Assigns a tier to a user directly in the DB (closes any existing active tier row first).
 * Requires the tier to already exist in the `tiers` table.
 */
export const setUserTierInDb = async (pool: Pool, userId: string, tierKey: string): Promise<void> => {
  await pool.query(
    `UPDATE user_tiers SET effective_to = NOW() WHERE user_id = $1 AND effective_to IS NULL`,
    [userId],
  );
  await pool.query(
    `INSERT INTO user_tiers (id, user_id, tier_id, source)
     SELECT uuid_generate_v4(), $1, id, 'test'
     FROM tiers WHERE key = $2`,
    [userId, tierKey],
  );
};

/**
 * Ensures base tier seed data (tiers + tier_limits) is present in the test DB.
 * Upserts free, premium, and pro tiers plus their key limits.
 * Call in beforeAll for tests that rely on tier limit data being visible.
 */
export const seedTiersForTest = async (pool: Pool): Promise<void> => {
  for (const [key, displayName, rank] of [['free', 'Free', 1], ['premium', 'Premium', 2], ['pro', 'Pro', 3]]) {
    await pool.query(
      `INSERT INTO tiers (id, key, display_name, rank) VALUES (uuid_generate_v4(), $1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [key, displayName, rank],
    );
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
    await pool.query(
      `INSERT INTO tier_limits (id, tier_id, limit_key, limit_value)
       SELECT uuid_generate_v4(), t.id, $2, $3::integer FROM tiers t WHERE t.key = $1
       ON CONFLICT (tier_id, limit_key) DO UPDATE SET limit_value = $3::integer`,
      [tierKey, limitKey, limitValue],
    );
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
    await pool.query(
      `INSERT INTO features (id, key, description, default_enabled)
       VALUES (uuid_generate_v4(), $1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, description, defaultEnabled],
    );
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
  for (const [tierKey, featureKey, isAllowed] of entitlements) {
    const tierResult = await pool.query(`SELECT id FROM tiers WHERE key = $1 LIMIT 1`, [tierKey]);
    const featureResult = await pool.query(`SELECT id FROM features WHERE key = $1 LIMIT 1`, [featureKey]);
    const tierId = tierResult.rows[0]?.id;
    const featureId = featureResult.rows[0]?.id;
    if (!tierId || !featureId) continue;
    await pool.query(
      `INSERT INTO tier_entitlements (id, tier_id, feature_id, is_allowed)
       VALUES (uuid_generate_v4(), $1, $2, $3)
       ON CONFLICT (tier_id, feature_id) DO UPDATE SET is_allowed = $3`,
      [tierId, featureId, isAllowed],
    );
  }
};
