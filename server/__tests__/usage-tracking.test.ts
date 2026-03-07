/**
 * Tests for usage counter tracking (incrementUsageCounter, atomicIncrementIfUnderLimit).
 * Tests the DB layer directly via pool queries without going through HTTP routes.
 */
import { Pool } from 'pg';
import { initDb, closePool, incrementUsageCounter, atomicIncrementIfUnderLimit } from '../src/db';
import { registerAndLoginWebUser } from './helpers';

const TS = Date.now();

describe('Usage tracking', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const result = await registerAndLoginWebUser(pool, {
      firstName: 'Usage',
      lastName: 'Tracker',
      email: `usage-tracking-test+${TS}@example.com`,
      password: 'TestPass1!',
    });
    userId = result.userId;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['usage-tracking-test+%']);
    await pool.end();
    await closePool();
  });

  describe('incrementUsageCounter', () => {
    it('creates a counter row and increments it', async () => {
      const metric = `test_metric_${TS}`;
      const window = '2026-03';

      await incrementUsageCounter(userId, metric, window);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
        [userId, metric, window],
      );
      expect(parseInt(rows[0]?.count ?? '0', 10)).toBe(1);
    });

    it('accumulates on multiple calls', async () => {
      const metric = `test_metric_multi_${TS}`;
      const window = '2026-03';

      await incrementUsageCounter(userId, metric, window);
      await incrementUsageCounter(userId, metric, window);
      await incrementUsageCounter(userId, metric, window);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
        [userId, metric, window],
      );
      expect(parseInt(rows[0]?.count ?? '0', 10)).toBe(3);
    });

    it('tracks separate windows independently', async () => {
      const metric = `test_metric_windows_${TS}`;

      await incrementUsageCounter(userId, metric, '2026-01');
      await incrementUsageCounter(userId, metric, '2026-02');
      await incrementUsageCounter(userId, metric, '2026-02');

      const { rows } = await pool.query<{ window_key: string; count: string }>(
        `SELECT window_key, count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 ORDER BY window_key`,
        [userId, metric],
      );
      const windows = Object.fromEntries(rows.map(r => [r.window_key, parseInt(r.count, 10)]));
      expect(windows['2026-01']).toBe(1);
      expect(windows['2026-02']).toBe(2);
    });
  });

  describe('atomicIncrementIfUnderLimit', () => {
    it('allows increment when count is under the limit', async () => {
      const metric = `test_atomic_${TS}`;
      const window = '2026-03';

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, 5);
      expect(result.allowed).toBe(true);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
        [userId, metric, window],
      );
      expect(parseInt(rows[0]?.count ?? '0', 10)).toBe(1);
    });

    it('blocks increment when count is at the limit', async () => {
      const metric = `test_atomic_blocked_${TS}`;
      const window = '2026-03';
      const limit = 3;

      // Seed count at the limit
      await pool.query(
        `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4)
         ON CONFLICT (user_id, metric_key, window_key) DO UPDATE SET count = $4`,
        [userId, metric, window, limit],
      );

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(result.allowed).toBe(false);

      // Count should remain at limit (not incremented)
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
        [userId, metric, window],
      );
      expect(parseInt(rows[0]?.count ?? '0', 10)).toBe(limit);
    });

    it('allows exactly limit-1 → limit (boundary)', async () => {
      const metric = `test_atomic_boundary_${TS}`;
      const window = '2026-03';
      const limit = 5;

      // Pre-fill to limit - 1
      await pool.query(
        `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4)
         ON CONFLICT (user_id, metric_key, window_key) DO UPDATE SET count = $4`,
        [userId, metric, window, limit - 1],
      );

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(result.allowed).toBe(true);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count FROM usage_counters WHERE user_id = $1 AND metric_key = $2 AND window_key = $3`,
        [userId, metric, window],
      );
      expect(parseInt(rows[0]?.count ?? '0', 10)).toBe(limit);
    });

    it('blocks once count equals limit after increment', async () => {
      const metric = `test_atomic_atmax_${TS}`;
      const window = '2026-03';
      const limit = 2;

      // Pre-fill to limit (already at limit)
      await pool.query(
        `INSERT INTO usage_counters (id, user_id, metric_key, window_key, count)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4)
         ON CONFLICT (user_id, metric_key, window_key) DO UPDATE SET count = $4`,
        [userId, metric, window, limit],
      );

      const r1 = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(r1.allowed).toBe(false);
    });
  });
});
