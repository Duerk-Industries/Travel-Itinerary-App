/// <reference types="jest" />
/// <reference types="node" />
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

// Seed a minimal import_jobs row in the given state directly via SQL, so we
// can control retry_count / completed_at / failure fields without driving a
// full pipeline. Matches the repo's schema exactly.
const seedImportJob = async (
  pool: import('pg').Pool,
  opts: {
    jobId: string;
    userId: string;
    ingestionSourceId: string;
    state: 'DEAD_LETTERED' | 'FAILED' | 'COMPLETED' | 'AWAITING_REVIEW';
    retryCount?: number;
    completedAtIso?: string | null;
    failureCode?: string | null;
    failureReason?: string | null;
    lastErrorCode?: string | null;
    idempotencyKey: string;
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run,
      retry_count, completed_at, failure_code, failure_reason, last_error_code
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15)`,
    [
      opts.jobId,
      opts.userId,
      opts.ingestionSourceId,
      opts.state,
      opts.idempotencyKey,
      `hash-${opts.jobId}`,
      `ext-${opts.jobId}`,
      `file-${opts.jobId}.pdf`,
      'application/pdf',
      `corr-${opts.jobId}`,
      opts.retryCount ?? 0,
      opts.completedAtIso ?? null,
      opts.failureCode ?? null,
      opts.failureReason ?? null,
      opts.lastErrorCode ?? null,
    ],
  );
};

describe('ingestion dead-letter behavior', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_admin_observability', true, null);
    // Reset the cached JobQueue so the next getJobQueue() picks up a fresh
    // InProcessJobQueue instance that tests can spy on.
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    queueMod.resetJobQueueForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mkUser = async (suffix: string) => {
    const helpers = require('./helpers') as typeof import('./helpers');
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Dead',
      lastName: 'Letter',
      email: `dead-letter-${suffix}@example.com`,
      password: 'secret123',
    });
    return userId;
  };

  // ─── Contract: updateImportJobState writes completed_at on terminal states ───
  it('updateImportJobState stamps completed_at and failure fields when transitioning to DEAD_LETTERED', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userId = await mkUser('transition');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await seedImportJob(pool, {
      jobId,
      userId,
      ingestionSourceId: sourceId,
      state: 'AWAITING_REVIEW',
      idempotencyKey: 'transition-1',
    });

    await repo.updateImportJobState({
      jobId,
      state: 'DEAD_LETTERED',
      failureCode: 'quota_exceeded',
      failureReason: 'Budget exhausted for this job',
      lastErrorCode: 'quota_exceeded',
    });

    const { rows } = await pool.query<{
      state: string; completed_at: string | null; failure_code: string | null; failure_reason: string | null; last_error_code: string | null;
    }>(`SELECT state, completed_at, failure_code, failure_reason, last_error_code FROM import_jobs WHERE id = $1`, [jobId]);
    expect(rows[0].state).toBe('DEAD_LETTERED');
    expect(rows[0].completed_at).not.toBeNull();
    expect(rows[0].failure_code).toBe('quota_exceeded');
    expect(rows[0].failure_reason).toBe('Budget exhausted for this job');
    expect(rows[0].last_error_code).toBe('quota_exceeded');
  });

  // ─── Contract: requeueImportJob resets all terminal-state scarring ───────────
  it('requeueImportJob on a DEAD_LETTERED job resets state to PENDING, increments retry_count, clears failure fields + completed_at', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userId = await mkUser('requeue');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await seedImportJob(pool, {
      jobId,
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      retryCount: 2,
      completedAtIso: new Date().toISOString(),
      failureCode: 'quota_exceeded',
      failureReason: 'Budget exhausted',
      lastErrorCode: 'quota_exceeded',
      idempotencyKey: 'requeue-1',
    });

    const updated = await repo.requeueImportJob(jobId);
    expect(updated).not.toBeNull();
    expect(updated!.state).toBe('PENDING');
    expect(updated!.retryCount).toBe(3);
    expect(updated!.failureCode).toBeNull();
    expect(updated!.failureReason).toBeNull();
    expect(updated!.lastErrorCode).toBeNull();
    expect(updated!.completedAt).toBeNull();
  });

  it('requeueImportJob returns null for an unknown jobId rather than creating a row', async () => {
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const result = await repo.requeueImportJob('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  // ─── State-gated requeue (Priority 13 correctness gate) ─────────────────────
  // `requeueImportJob` now only accepts jobs in terminal failure states
  // (DEAD_LETTERED or FAILED). Active-state and successful-terminal jobs
  // return null with no side effects.
  it('requeueImportJob accepts FAILED jobs (state gate allows the manual-retry path)', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userId = await mkUser('state-gate-failed');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const failedJobId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    await seedImportJob(pool, {
      jobId: failedJobId, userId, ingestionSourceId: sourceId,
      state: 'FAILED', retryCount: 1, idempotencyKey: 'state-gate-failed',
    });
    const updated = await repo.requeueImportJob(failedJobId);
    expect(updated?.state).toBe('PENDING');
    expect(updated?.retryCount).toBe(2);
  });

  it('requeueImportJob rejects active-state jobs (AWAITING_REVIEW) without mutating them', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userId = await mkUser('state-gate-active');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const activeJobId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    await seedImportJob(pool, {
      jobId: activeJobId, userId, ingestionSourceId: sourceId,
      state: 'AWAITING_REVIEW', retryCount: 0, idempotencyKey: 'state-gate-active',
    });
    const result = await repo.requeueImportJob(activeJobId);
    expect(result).toBeNull();

    // Row must be untouched.
    const { rows } = await pool.query<{ state: string; retry_count: number }>(
      `SELECT state, retry_count FROM import_jobs WHERE id = $1`, [activeJobId],
    );
    expect(rows[0].state).toBe('AWAITING_REVIEW');
    expect(Number(rows[0].retry_count)).toBe(0);
  });

  it('requeueImportJob rejects COMPLETED jobs (successful-terminal) without mutating them', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userId = await mkUser('state-gate-completed');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const completedJobId = 'dddddddd-dddd-dddd-dddd-dddddddddccc';
    await seedImportJob(pool, {
      jobId: completedJobId, userId, ingestionSourceId: sourceId,
      state: 'COMPLETED', retryCount: 0, idempotencyKey: 'state-gate-completed',
    });
    const result = await repo.requeueImportJob(completedJobId);
    expect(result).toBeNull();

    const { rows } = await pool.query<{ state: string }>(
      `SELECT state FROM import_jobs WHERE id = $1`, [completedJobId],
    );
    expect(rows[0].state).toBe('COMPLETED');
  });

  // ─── Contract: requeueDeadLetterImportJob enqueues via the configured queue ─
  it('requeueDeadLetterImportJob calls getJobQueue().enqueue exactly once with the job id', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');

    const userId = await mkUser('enqueue');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await seedImportJob(pool, {
      jobId,
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      retryCount: 1,
      completedAtIso: new Date().toISOString(),
      idempotencyKey: 'enqueue-1',
    });

    const queue = queueMod.getJobQueue();
    const enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);

    const result = await orchestrator.requeueDeadLetterImportJob(jobId);
    expect(result.id).toBe(jobId);
    expect(result.state).toBe('PENDING');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(jobId);
  });

  it('requeueDeadLetterImportJob throws when the job id is not found', async () => {
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    await expect(
      orchestrator.requeueDeadLetterImportJob('99999999-9999-9999-9999-999999999999'),
    ).rejects.toThrow(/not found/i);
  });

  // ─── Admin re-drive endpoint: loops over all DEAD_LETTERED matches ───────────
  it('POST /api/admin/ingestion/dead-letter/re-drive re-drives every DEAD_LETTERED job and ignores other states', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');

    const admin = await helpers.makeAdminUser({
      firstName: 'Admin',
      lastName: 'DeadLetter',
      email: `dl-admin-${Date.now()}@example.com`,
      password: 'secret123',
    });
    const userId = await mkUser('admin-redrive');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const deadA = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
    const deadB = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
    const completed = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

    await seedImportJob(pool, {
      jobId: deadA, userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', retryCount: 3, completedAtIso: new Date().toISOString(),
      idempotencyKey: 'dead-a',
    });
    await seedImportJob(pool, {
      jobId: deadB, userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', retryCount: 0, completedAtIso: new Date().toISOString(),
      idempotencyKey: 'dead-b',
    });
    await seedImportJob(pool, {
      jobId: completed, userId, ingestionSourceId: sourceId,
      state: 'COMPLETED', retryCount: 0, completedAtIso: new Date().toISOString(),
      idempotencyKey: 'done-c',
    });

    const queue = queueMod.getJobQueue();
    const enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/admin/ingestion/dead-letter/re-drive')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ provider: 'ALL' })
      .expect(200);

    expect(res.body.matched).toBe(2);
    expect(res.body.retried).toBe(2);

    // Both dead-lettered jobs enqueued, non-dead-lettered job untouched.
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const enqueuedIds = new Set(enqueueSpy.mock.calls.map((c) => c[0]));
    expect(enqueuedIds).toEqual(new Set([deadA, deadB]));

    const { rows } = await pool.query<{ id: string; state: string; retry_count: number }>(
      `SELECT id, state, retry_count FROM import_jobs ORDER BY id`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[deadA].state).toBe('PENDING');
    expect(Number(byId[deadA].retry_count)).toBe(4);
    expect(byId[deadB].state).toBe('PENDING');
    expect(Number(byId[deadB].retry_count)).toBe(1);
    expect(byId[completed].state).toBe('COMPLETED');
    expect(Number(byId[completed].retry_count)).toBe(0);
  });

  it('POST /api/admin/ingestion/dead-letter/re-drive returns matched=0 retried=0 when no DEAD_LETTERED jobs exist', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');

    const admin = await helpers.makeAdminUser({
      firstName: 'Admin',
      lastName: 'NoMatch',
      email: `dl-admin-none-${Date.now()}@example.com`,
      password: 'secret123',
    });

    const res = await request(app)
      .post('/api/admin/ingestion/dead-letter/re-drive')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ provider: 'ALL' })
      .expect(200);

    expect(res.body).toEqual({ provider: 'ALL', matched: 0, retried: 0 });
  });

  it('POST /api/admin/ingestion/dead-letter/re-drive returns 403 when the admin observability feature flag is disabled', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');

    const admin = await helpers.makeAdminUser({
      firstName: 'Admin',
      lastName: 'FlagOff',
      email: `dl-admin-flag-${Date.now()}@example.com`,
      password: 'secret123',
    });
    await db.setFeatureFlag('feature_ingest_admin_observability', false, null);

    const res = await request(app)
      .post('/api/admin/ingestion/dead-letter/re-drive')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ provider: 'ALL' })
      .expect(403);
    expect(res.body.error).toMatch(/disabled/i);
  });
});
