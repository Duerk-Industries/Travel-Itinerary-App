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
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false)`,
    [
      opts.jobId, opts.userId, opts.ingestionSourceId, opts.state,
      `idem-${opts.jobId}`, `hash-${opts.jobId}`, `ext-${opts.jobId}`,
      `file-${opts.jobId}.pdf`, 'application/pdf', `corr-${opts.jobId}`,
    ],
  );
};

describe('ingestionMetricsService', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    const { resetMetricCountersForTests } = require('../src/metrics') as typeof import('../src/metrics');
    resetMetricCountersForTests();
  });

  it('runIngestionMetricsTick records per-state gauges + headline dead-letter/pending gauges', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');
    const svc = require('../src/services/ingestionMetricsService') as typeof import('../src/services/ingestionMetricsService');
    const { getMetricCounterSnapshot } = require('../src/metrics') as typeof import('../src/metrics');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Metrics', lastName: 'Tick',
      email: 'metrics-tick@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    await seedJob(pool, { jobId: '11111111-1111-1111-1111-111111111111', userId, ingestionSourceId: sourceId, state: 'PENDING' });
    await seedJob(pool, { jobId: '22222222-2222-2222-2222-222222222222', userId, ingestionSourceId: sourceId, state: 'PENDING' });
    await seedJob(pool, { jobId: '33333333-3333-3333-3333-333333333333', userId, ingestionSourceId: sourceId, state: 'DEAD_LETTERED' });
    await seedJob(pool, { jobId: '44444444-4444-4444-4444-444444444444', userId, ingestionSourceId: sourceId, state: 'COMPLETED' });

    const counts = await svc.runIngestionMetricsTick();
    expect(counts).toEqual({ PENDING: 2, DEAD_LETTERED: 1, COMPLETED: 1 });

    const snapshot = getMetricCounterSnapshot();
    const byState = snapshot.gauges.filter((g) => g.name === 'ingestion_jobs_by_state');
    const byStateByLabel = Object.fromEntries(byState.map((g) => [g.labels?.state, g.value]));
    expect(byStateByLabel.PENDING).toBe(2);
    expect(byStateByLabel.DEAD_LETTERED).toBe(1);
    expect(byStateByLabel.COMPLETED).toBe(1);

    const deadLetterDepth = snapshot.gauges.find((g) => g.name === 'ingestion_dead_letter_depth');
    const pendingDepth = snapshot.gauges.find((g) => g.name === 'ingestion_pending_depth');
    expect(deadLetterDepth?.value).toBe(1);
    expect(pendingDepth?.value).toBe(2);
  });

  it('emits zero-valued headline gauges when no jobs exist', async () => {
    const svc = require('../src/services/ingestionMetricsService') as typeof import('../src/services/ingestionMetricsService');
    const { getMetricCounterSnapshot } = require('../src/metrics') as typeof import('../src/metrics');

    const counts = await svc.runIngestionMetricsTick();
    expect(counts).toEqual({});

    const snapshot = getMetricCounterSnapshot();
    expect(snapshot.gauges.find((g) => g.name === 'ingestion_dead_letter_depth')?.value).toBe(0);
    expect(snapshot.gauges.find((g) => g.name === 'ingestion_pending_depth')?.value).toBe(0);
  });

  it('Prometheus /metrics endpoint renders the queue-depth gauges alongside counters', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');
    const svc = require('../src/services/ingestionMetricsService') as typeof import('../src/services/ingestionMetricsService');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Metrics', lastName: 'Prom',
      email: 'metrics-prom@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    await seedJob(pool, { jobId: 'aaaa0000-0000-0000-0000-000000000001', userId, ingestionSourceId: sourceId, state: 'PENDING' });
    await seedJob(pool, { jobId: 'aaaa0000-0000-0000-0000-000000000002', userId, ingestionSourceId: sourceId, state: 'DEAD_LETTERED' });

    await svc.runIngestionMetricsTick();

    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toMatch(/# TYPE ingestion_jobs_by_state gauge/);
    // Every gauge line carries an `instance` label merged in by the Prom
    // renderer before the caller-supplied labels.
    expect(res.text).toMatch(/ingestion_jobs_by_state\{instance="[^"]+",state="DEAD_LETTERED"\} 1/);
    expect(res.text).toMatch(/ingestion_jobs_by_state\{instance="[^"]+",state="PENDING"\} 1/);
    expect(res.text).toMatch(/# TYPE ingestion_dead_letter_depth gauge/);
    expect(res.text).toMatch(/ingestion_dead_letter_depth\{instance="[^"]+"\} 1/);
    expect(res.text).toMatch(/ingestion_pending_depth\{instance="[^"]+"\} 1/);
  });

  it('a later tick overwrites the previous gauge value (not cumulative)', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');
    const svc = require('../src/services/ingestionMetricsService') as typeof import('../src/services/ingestionMetricsService');
    const { getMetricCounterSnapshot } = require('../src/metrics') as typeof import('../src/metrics');

    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Metrics', lastName: 'Overwrite',
      email: 'metrics-overwrite@example.com', password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    await seedJob(pool, { jobId: 'bbbb0000-0000-0000-0000-000000000001', userId, ingestionSourceId: sourceId, state: 'PENDING' });
    await svc.runIngestionMetricsTick();
    expect(getMetricCounterSnapshot().gauges.find((g) => g.name === 'ingestion_pending_depth')?.value).toBe(1);

    // Delete the job, re-tick — gauge should now read 0, not 1.
    await pool.query(`DELETE FROM import_jobs WHERE id = $1`, ['bbbb0000-0000-0000-0000-000000000001']);
    await svc.runIngestionMetricsTick();
    expect(getMetricCounterSnapshot().gauges.find((g) => g.name === 'ingestion_pending_depth')?.value).toBe(0);
  });
});
