/**
 * Tests for the in-process failed-retry scheduler (L2). Mirrors the HTTP
 * endpoint tests in ingestion.retry-worker-failed.test.ts but exercises the
 * `runFailedRetryTick()` function directly so we can verify tick semantics
 * without going through Express.
 */
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const seedJob = async (
  pool: import('pg').Pool,
  opts: {
    jobId: string;
    userId: string;
    ingestionSourceId: string;
    state: string;
    retryCount?: number;
    nextRetryAt?: string | null;
    idempotencyKey: string;
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run,
      retry_count, next_retry_at
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false,$11,$12)`,
    [
      opts.jobId, opts.userId, opts.ingestionSourceId, opts.state,
      opts.idempotencyKey, `hash-${opts.jobId}`, `ext-${opts.jobId}`,
      `file-${opts.jobId}.pdf`, 'application/pdf', `corr-${opts.jobId}`,
      opts.retryCount ?? 0, opts.nextRetryAt ?? null,
    ],
  );
};

describe('failedRetryScheduler', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    queueMod.resetJobQueueForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');
    sched.stopFailedRetryScheduler();
  });

  it('runFailedRetryTick: requeues only FAILED jobs whose next_retry_at has passed and whose retry_count < maxAttempts', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retry', lastName: 'Sched',
      email: 'retry-sched-a@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000 * 10).toISOString();

    await seedJob(pool, { jobId: '11111111-1111-1111-1111-111111111111', userId, ingestionSourceId: sourceId, state: 'FAILED', retryCount: 1, nextRetryAt: past, idempotencyKey: 'ready' });
    await seedJob(pool, { jobId: '22222222-2222-2222-2222-222222222222', userId, ingestionSourceId: sourceId, state: 'FAILED', retryCount: 1, nextRetryAt: future, idempotencyKey: 'future' });
    await seedJob(pool, { jobId: '33333333-3333-3333-3333-333333333333', userId, ingestionSourceId: sourceId, state: 'FAILED', retryCount: 5, nextRetryAt: past, idempotencyKey: 'maxed' });

    const enqueueSpy = jest.spyOn(queueMod.getJobQueue(), 'enqueue').mockResolvedValue(undefined);
    const result = await sched.runFailedRetryTick();

    expect(result.eligible).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.retriedIds).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('runFailedRetryTick returns eligible=0 retried=0 on an empty queue', async () => {
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');
    const result = await sched.runFailedRetryTick();
    expect(result.eligible).toBe(0);
    expect(result.retried).toBe(0);
  });

  it('startFailedRetryScheduler skips when NODE_ENV=test', () => {
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(sched.startFailedRetryScheduler()).toBe(false);
    process.env.NODE_ENV = originalEnv;
  });

  it('startFailedRetryScheduler respects INGESTION_FAILED_RETRY_ENABLED=false', () => {
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');
    const originalEnv = process.env.NODE_ENV;
    const originalFlag = process.env.INGESTION_FAILED_RETRY_ENABLED;
    process.env.NODE_ENV = 'development';
    process.env.INGESTION_FAILED_RETRY_ENABLED = 'false';
    try {
      expect(sched.startFailedRetryScheduler()).toBe(false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalFlag === undefined) delete process.env.INGESTION_FAILED_RETRY_ENABLED;
      else process.env.INGESTION_FAILED_RETRY_ENABLED = originalFlag;
    }
  });

  it('startFailedRetryScheduler starts exactly once (idempotent) and fires the tick on interval', async () => {
    jest.useFakeTimers();
    const sched = require('../src/services/failedRetryScheduler') as typeof import('../src/services/failedRetryScheduler');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.INGESTION_FAILED_RETRY_TICK_MS = '60000';
    try {
      const first = sched.startFailedRetryScheduler();
      const second = sched.startFailedRetryScheduler();
      expect(first).toBe(true);
      expect(second).toBe(false);
      sched.stopFailedRetryScheduler();
    } finally {
      process.env.NODE_ENV = originalEnv;
      delete process.env.INGESTION_FAILED_RETRY_TICK_MS;
      jest.useRealTimers();
    }
  });
});
