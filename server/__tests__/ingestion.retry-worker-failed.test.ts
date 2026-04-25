const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  process.env.INGESTION_WORKER_SHARED_SECRET = 'test-worker-secret';
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

describe('POST /api/internal/ingestion/retries/failed/run', () => {
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
  });

  const setupUser = async (emailSuffix: string): Promise<{ userId: string; sourceId: string; pool: import('pg').Pool }> => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retry', lastName: 'Worker',
      email: `retry-worker-${emailSuffix}@example.com`,
      password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    return { userId, sourceId, pool: poolClient() };
  };

  it('rejects requests without the X-Ingestion-Worker-Secret header with 403', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    await request(app).post('/api/internal/ingestion/retries/failed/run').expect(403);
  });

  it('returns eligible=0 retried=0 when no FAILED jobs are ready', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const res = await request(app)
      .post('/api/internal/ingestion/retries/failed/run')
      .set('X-Ingestion-Worker-Secret', 'test-worker-secret')
      .expect(200);
    expect(res.body.eligible).toBe(0);
    expect(res.body.retried).toBe(0);
  });

  it('picks only FAILED jobs with next_retry_at in the past and retry_count < maxAttempts', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    const { userId, sourceId, pool } = await setupUser('eligible');

    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000 * 10).toISOString();

    // Ready to retry.
    await seedJob(pool, {
      jobId: '11111111-1111-1111-1111-111111111111', userId, ingestionSourceId: sourceId,
      state: 'FAILED', retryCount: 1, nextRetryAt: past, idempotencyKey: 'ready',
    });
    // Not yet due.
    await seedJob(pool, {
      jobId: '22222222-2222-2222-2222-222222222222', userId, ingestionSourceId: sourceId,
      state: 'FAILED', retryCount: 1, nextRetryAt: future, idempotencyKey: 'not-yet',
    });
    // DEAD_LETTERED — not picked by this endpoint.
    await seedJob(pool, {
      jobId: '33333333-3333-3333-3333-333333333333', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', retryCount: 99, nextRetryAt: past, idempotencyKey: 'dead',
    });
    // Max-attempts exhausted.
    await seedJob(pool, {
      jobId: '44444444-4444-4444-4444-444444444444', userId, ingestionSourceId: sourceId,
      state: 'FAILED', retryCount: 5, nextRetryAt: past, idempotencyKey: 'maxed-out',
    });

    const queue = queueMod.getJobQueue();
    const enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/internal/ingestion/retries/failed/run')
      .set('X-Ingestion-Worker-Secret', 'test-worker-secret')
      .expect(200);

    expect(res.body.eligible).toBe(1);
    expect(res.body.retried).toBe(1);
    expect(res.body.retriedIds).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');

    // The chosen job was requeued: its state is back to PENDING and
    // retry_count bumped by the gate in requeueImportJob.
    const { rows } = await pool.query<{ state: string; retry_count: number }>(
      `SELECT state, retry_count FROM import_jobs WHERE id = $1`,
      ['11111111-1111-1111-1111-111111111111'],
    );
    expect(rows[0].state).toBe('PENDING');
    expect(Number(rows[0].retry_count)).toBe(2);
  });

  it('honors body.limit to cap the batch size', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    const { userId, sourceId, pool } = await setupUser('limit');

    const past = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 3; i += 1) {
      await seedJob(pool, {
        jobId: `5${i}5${i}5${i}5${i}-5${i}5${i}-5${i}5${i}-5${i}5${i}-${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
        userId, ingestionSourceId: sourceId,
        state: 'FAILED', retryCount: 1, nextRetryAt: past, idempotencyKey: `lim-${i}`,
      });
    }
    jest.spyOn(queueMod.getJobQueue(), 'enqueue').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/internal/ingestion/retries/failed/run')
      .set('X-Ingestion-Worker-Secret', 'test-worker-secret')
      .send({ limit: 2 })
      .expect(200);

    expect(res.body.eligible).toBe(2);
    expect(res.body.retried).toBe(2);
  });
});
