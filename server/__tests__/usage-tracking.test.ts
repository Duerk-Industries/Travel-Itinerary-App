/// <reference types="jest" />
/// <reference types="node" />
/**
 * Tests for usage counter tracking (incrementUsageCounter, atomicIncrementIfUnderLimit).
 * Tests the DB layer directly via the db facade without going through HTTP routes.
 */
import { initDb, closePool, incrementUsageCounter, atomicIncrementIfUnderLimit, getUsageCounter, setUsageCounter } from '../src/db';
import { registerAndLoginWebUser, cleanupTestUsersByEmail } from './helpers';

const TS = Date.now();

describe('Usage tracking', () => {
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();

    const result = await registerAndLoginWebUser({
      firstName: 'Usage',
      lastName: 'Tracker',
      email: `usage-tracking-test+${TS}@example.com`,
      password: 'TestPass1!',
    });
    userId = result.userId;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([`usage-tracking-test+${TS}@example.com`]);
    await closePool();
  });

  describe('incrementUsageCounter', () => {
    it('creates a counter row and increments it', async () => {
      const metric = `test_metric_${TS}`;
      const window = '2026-03';

      await incrementUsageCounter(userId, metric, window);

      const count = await getUsageCounter(userId, metric, window);
      expect(count).toBe(1);
    });

    it('accumulates on multiple calls', async () => {
      const metric = `test_metric_multi_${TS}`;
      const window = '2026-03';

      await incrementUsageCounter(userId, metric, window);
      await incrementUsageCounter(userId, metric, window);
      await incrementUsageCounter(userId, metric, window);

      const count = await getUsageCounter(userId, metric, window);
      expect(count).toBe(3);
    });

    it('tracks separate windows independently', async () => {
      const metric = `test_metric_windows_${TS}`;

      await incrementUsageCounter(userId, metric, '2026-01');
      await incrementUsageCounter(userId, metric, '2026-02');
      await incrementUsageCounter(userId, metric, '2026-02');

      const count01 = await getUsageCounter(userId, metric, '2026-01');
      const count02 = await getUsageCounter(userId, metric, '2026-02');
      expect(count01).toBe(1);
      expect(count02).toBe(2);
    });
  });

  describe('atomicIncrementIfUnderLimit', () => {
    it('allows increment when count is under the limit', async () => {
      const metric = `test_atomic_${TS}`;
      const window = '2026-03';

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, 5);
      expect(result.allowed).toBe(true);

      const count = await getUsageCounter(userId, metric, window);
      expect(count).toBe(1);
    });

    it('blocks increment when count is at the limit', async () => {
      const metric = `test_atomic_blocked_${TS}`;
      const window = '2026-03';
      const limit = 3;

      // Seed count at the limit
      await setUsageCounter(userId, metric, window, limit);

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(result.allowed).toBe(false);

      // Count should remain at limit (not incremented)
      const count = await getUsageCounter(userId, metric, window);
      expect(count).toBe(limit);
    });

    it('allows exactly limit-1 → limit (boundary)', async () => {
      const metric = `test_atomic_boundary_${TS}`;
      const window = '2026-03';
      const limit = 5;

      // Pre-fill to limit - 1
      await setUsageCounter(userId, metric, window, limit - 1);

      const result = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(result.allowed).toBe(true);

      const count = await getUsageCounter(userId, metric, window);
      expect(count).toBe(limit);
    });

    it('blocks once count equals limit after increment', async () => {
      const metric = `test_atomic_atmax_${TS}`;
      const window = '2026-03';
      const limit = 2;

      // Pre-fill to limit (already at limit)
      await setUsageCounter(userId, metric, window, limit);

      const r1 = await atomicIncrementIfUnderLimit(userId, metric, window, limit);
      expect(r1.allowed).toBe(false);
    });
  });
});
