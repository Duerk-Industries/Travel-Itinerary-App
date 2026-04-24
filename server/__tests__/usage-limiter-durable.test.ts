import { closePool, initDb, resetDbAdapter } from '../src/db';
import {
  ApiLimitExceededError,
  __resetInProcessUsageCachesForTests,
  getApiUsageSummary,
  resetApiUsageSummaries,
  reserveApiUsageOrThrow,
} from '../src/apis/usageLimiter';

describe('durable API usage limiter', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/usage-limiter-durable';
    delete process.env.E2E_MODE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    resetDbAdapter();
    await initDb();
  });

  beforeEach(async () => {
    await resetApiUsageSummaries();
  });

  afterAll(async () => {
    await closePool();
  });

  it('stores OPENAI usage in durable counters and reports it in the current window summary', async () => {
    await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: 'ITINERARY_PLAN_P0_NORM' });
    await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: 'ITINERARY_PLAN_P0_NORM' });

    const summary = await getApiUsageSummary();
    const overall = summary.find((entry) => entry.provider === 'OPENAI' && entry.scope === 'overall');
    const caller = summary.find(
      (entry) => entry.provider === 'OPENAI' && entry.scope === 'caller' && entry.caller === 'ITINERARY_PLAN_P0_NORM'
    );

    expect(overall?.used).toBe(2);
    expect(caller?.used).toBe(2);
  });

  it('blocks once the configured caller limit is exhausted', async () => {
    for (let i = 0; i < 200; i += 1) {
      await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: 'ITINERARY_PLAN_P0_NORM' });
    }

    await expect(
      reserveApiUsageOrThrow({ provider: 'OPENAI', caller: 'ITINERARY_PLAN_P0_NORM' })
    ).rejects.toMatchObject({
      name: 'ApiLimitExceededError',
      provider: 'OPENAI',
      caller: 'ITINERARY_PLAN_P0_NORM',
      scope: 'caller',
    });
  });

  // ─── Multi-instance / contention ─────────────────────────────────────────
  //
  // Multi-instance coordination reduces to "concurrent writers sharing a DB
  // pool". The atomicity is provided by the `UPDATE ... WHERE count < $limit`
  // SQL statement — a single atomic comparison-and-increment. A concurrent
  // contention test exercises the exact same code path that would be hit by
  // two Node processes pointed at the same Postgres, so it is a valid proxy
  // for cross-instance coordination.
  //
  // The caller `ITINERARY_GENERATE_PLAN` has a configured limit of 50 in
  // `config/api-limits.yaml`, so firing 80 concurrent reservations should
  // result in exactly 50 successes and 30 `ApiLimitExceededError`s.
  it('under high concurrency, grants exactly `limit` reservations and rejects the overflow', async () => {
    const CALLER = 'ITINERARY_GENERATE_PLAN';
    const LIMIT = 50;
    const CONCURRENT = 80;

    const settled = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, () =>
        reserveApiUsageOrThrow({ provider: 'OPENAI', caller: CALLER }),
      ),
    );

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(LIMIT);
    expect(rejected).toHaveLength(CONCURRENT - LIMIT);

    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ApiLimitExceededError);
      expect(reason).toMatchObject({
        name: 'ApiLimitExceededError',
        provider: 'OPENAI',
        caller: CALLER,
        scope: 'caller',
        limit: LIMIT,
      });
    }

    // The durable counter must match `limit` exactly — no over-counting, no
    // under-counting. This is the multi-instance invariant.
    const summary = await getApiUsageSummary();
    const callerEntry = summary.find(
      (entry) => entry.scope === 'caller' && entry.caller === CALLER,
    );
    expect(callerEntry?.used).toBe(LIMIT);
  });

  // ─── Process restart ─────────────────────────────────────────────────────
  //
  // If a server instance restarts, the in-memory `usageBuckets` cache is
  // wiped. The durable counter table must be re-read so the next reservation
  // still sees the prior count. This test simulates the restart by clearing
  // only the in-process caches (not the DB) and verifying the limit is still
  // enforced at the same watermark.
  it('preserves durable counters across simulated process restart', async () => {
    const CALLER = 'ITINERARY_GENERATE_PLAN';
    const LIMIT = 50;

    // Consume most (but not all) of the limit on "instance A".
    for (let i = 0; i < LIMIT - 10; i += 1) {
      await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: CALLER });
    }

    const preSummary = await getApiUsageSummary();
    const preUsed = preSummary.find((e) => e.scope === 'caller' && e.caller === CALLER)?.used;
    expect(preUsed).toBe(LIMIT - 10);

    // Simulate a restart: drop the in-memory caches so "instance B" must
    // re-read the durable counters on its first reservation.
    __resetInProcessUsageCachesForTests();

    // Consume exactly the remaining budget — should all succeed.
    for (let i = 0; i < 10; i += 1) {
      await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: CALLER });
    }

    // One more should be rejected — proving the restart did not reset the
    // effective usage.
    await expect(
      reserveApiUsageOrThrow({ provider: 'OPENAI', caller: CALLER }),
    ).rejects.toMatchObject({
      name: 'ApiLimitExceededError',
      provider: 'OPENAI',
      caller: CALLER,
      scope: 'caller',
      limit: LIMIT,
      used: LIMIT,
    });

    const postSummary = await getApiUsageSummary();
    const postUsed = postSummary.find((e) => e.scope === 'caller' && e.caller === CALLER)?.used;
    expect(postUsed).toBe(LIMIT);
  });
});
