const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

import { computeNextRetryAt } from '../src/ingestion/shared/repository';

describe('computeNextRetryAt (pure backoff helper)', () => {
  const now = new Date('2026-04-24T12:00:00Z');

  it('applies exponential base on the first attempt', () => {
    const iso = computeNextRetryAt(1, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now });
    // attempt 1 → base * 2^0 = 30s
    expect(new Date(iso).getTime() - now.getTime()).toBe(30 * 1000);
  });

  it('doubles with each attempt', () => {
    expect(new Date(computeNextRetryAt(2, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now })).getTime() - now.getTime())
      .toBe(60 * 1000); // 30 * 2
    expect(new Date(computeNextRetryAt(3, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now })).getTime() - now.getTime())
      .toBe(120 * 1000); // 30 * 4
    expect(new Date(computeNextRetryAt(4, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now })).getTime() - now.getTime())
      .toBe(240 * 1000); // 30 * 8
  });

  it('caps at maxDelaySeconds', () => {
    const iso = computeNextRetryAt(20, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now });
    expect(new Date(iso).getTime() - now.getTime()).toBe(1800 * 1000);
  });

  it('never goes below base', () => {
    const iso = computeNextRetryAt(0, { baseDelaySeconds: 30, maxDelaySeconds: 1800, now });
    expect(new Date(iso).getTime() - now.getTime()).toBe(30 * 1000);
  });
});

describe('updateImportJobState next_retry_at population', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  const seedJob = async (
    pool: import('pg').Pool,
    opts: {
      jobId: string;
      userId: string;
      ingestionSourceId: string;
      state: string;
      retryCount?: number;
    },
  ) => {
    await pool.query(
      `INSERT INTO import_jobs (
        id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
        external_message_id, original_filename, mime_type, correlation_id, dry_run, retry_count
      ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false,$11)`,
      [
        opts.jobId,
        opts.userId,
        opts.ingestionSourceId,
        opts.state,
        `idem-${opts.jobId}`,
        `hash-${opts.jobId}`,
        `ext-${opts.jobId}`,
        `file-${opts.jobId}.pdf`,
        'application/pdf',
        `corr-${opts.jobId}`,
        opts.retryCount ?? 0,
      ],
    );
  };

  it('stamps next_retry_at when the job transitions to FAILED', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retry', lastName: 'Prep', email: 'retry-prep-failed@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = '11111111-1111-1111-1111-111111111111';
    await seedJob(pool, { jobId, userId, ingestionSourceId: sourceId, state: 'AWAITING_REVIEW', retryCount: 0 });

    await repo.updateImportJobState({ jobId, state: 'FAILED', failureReason: 'test failure' });

    const { rows } = await pool.query<{ next_retry_at: string | null; state: string }>(
      `SELECT next_retry_at, state FROM import_jobs WHERE id = $1`, [jobId],
    );
    expect(rows[0].state).toBe('FAILED');
    expect(rows[0].next_retry_at).not.toBeNull();
    // Should be ~30s in the future (base * 2^0 for retryCount 0+1 = 1).
    const delta = new Date(rows[0].next_retry_at!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(20 * 1000);
    expect(delta).toBeLessThan(60 * 1000);
  });

  it('clears next_retry_at when the job transitions to DEAD_LETTERED', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retry', lastName: 'Prep', email: 'retry-prep-dl@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = '22222222-2222-2222-2222-222222222222';
    await seedJob(pool, { jobId, userId, ingestionSourceId: sourceId, state: 'AWAITING_REVIEW', retryCount: 5 });

    // First FAILED → stamps next_retry_at.
    await repo.updateImportJobState({ jobId, state: 'FAILED' });
    let { rows } = await pool.query<{ next_retry_at: string | null }>(
      `SELECT next_retry_at FROM import_jobs WHERE id = $1`, [jobId],
    );
    expect(rows[0].next_retry_at).not.toBeNull();

    // Then DEAD_LETTERED → clears it (terminal state).
    await repo.updateImportJobState({ jobId, state: 'DEAD_LETTERED' });
    rows = (await pool.query(`SELECT next_retry_at FROM import_jobs WHERE id = $1`, [jobId])).rows;
    expect(rows[0].next_retry_at).toBeNull();
  });

  it('does not touch next_retry_at for non-terminal transitions', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retry', lastName: 'Prep', email: 'retry-prep-noop@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const jobId = '33333333-3333-3333-3333-333333333333';
    await seedJob(pool, { jobId, userId, ingestionSourceId: sourceId, state: 'PENDING', retryCount: 0 });

    // Pre-set a next_retry_at directly so we can tell whether a non-terminal
    // transition preserves it.
    await pool.query(
      `UPDATE import_jobs SET next_retry_at = '2030-01-01T00:00:00.000Z' WHERE id = $1`,
      [jobId],
    );

    await repo.updateImportJobState({ jobId, state: 'NORMALIZING' });

    const { rows } = await pool.query<{ next_retry_at: string | null }>(
      `SELECT next_retry_at FROM import_jobs WHERE id = $1`, [jobId],
    );
    expect(rows[0].next_retry_at).not.toBeNull();
    expect(new Date(rows[0].next_retry_at!).getUTCFullYear()).toBe(2030);
  });
});
