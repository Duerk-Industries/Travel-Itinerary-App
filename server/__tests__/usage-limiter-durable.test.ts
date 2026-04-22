import { closePool, initDb, resetDbAdapter } from '../src/db';
import { getApiUsageSummary, resetApiUsageSummaries, reserveApiUsageOrThrow } from '../src/apis/usageLimiter';

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
});
