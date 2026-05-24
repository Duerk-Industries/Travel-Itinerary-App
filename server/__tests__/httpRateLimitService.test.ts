import { closePool, initDb, resetApiUsageCounters, resetDbAdapter } from '../src/db';
import {
  HttpRateLimitExceededError,
  formatRateLimitWindowKey,
  reserveHttpRateLimitOrThrow,
} from '../src/services/httpRateLimitService';

describe('durable HTTP rate limiting', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/http-rate-limit';
    delete process.env.E2E_MODE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    resetDbAdapter();
    await initDb();
  });

  beforeEach(async () => {
    await resetApiUsageCounters();
  });

  afterAll(async () => {
    await closePool();
  });

  it('blocks the same identity after the configured fixed-window limit', async () => {
    const params = {
      name: 'auth_login_test',
      identity: 'identifier:traveler@example.com',
      limit: 2,
      windowMs: 60_000,
      nowMs: Date.UTC(2026, 4, 24, 12, 0, 0),
    };

    await reserveHttpRateLimitOrThrow(params);
    await reserveHttpRateLimitOrThrow(params);

    await expect(reserveHttpRateLimitOrThrow(params)).rejects.toBeInstanceOf(HttpRateLimitExceededError);
  });

  it('shares counters across simulated process restarts because state is DB-backed', async () => {
    const params = {
      name: 'itinerary_generation_test',
      identity: 'user:00000000-0000-0000-0000-000000000001',
      limit: 1,
      windowMs: 60_000,
      nowMs: Date.UTC(2026, 4, 24, 12, 0, 0),
    };

    await reserveHttpRateLimitOrThrow(params);

    await expect(reserveHttpRateLimitOrThrow(params)).rejects.toMatchObject({
      name: 'HttpRateLimitExceededError',
      limit: 1,
      used: 1,
    });
  });

  it('allows the same identity again in the next fixed window', async () => {
    const windowMs = 60_000;
    const firstWindow = Date.UTC(2026, 4, 24, 12, 0, 0);
    const secondWindow = firstWindow + windowMs;
    expect(formatRateLimitWindowKey(windowMs, firstWindow)).not.toBe(
      formatRateLimitWindowKey(windowMs, secondWindow),
    );

    await reserveHttpRateLimitOrThrow({
      name: 'auth_login_window_test',
      identity: 'ip:203.0.113.10',
      limit: 1,
      windowMs,
      nowMs: firstWindow,
    });

    await expect(
      reserveHttpRateLimitOrThrow({
        name: 'auth_login_window_test',
        identity: 'ip:203.0.113.10',
        limit: 1,
        windowMs,
        nowMs: secondWindow,
      }),
    ).resolves.toBeUndefined();
  });
});
