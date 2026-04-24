const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

interface SeedOpts {
  jobId: string;
  userId: string;
  ingestionSourceId: string;
  state: 'DEAD_LETTERED' | 'COMPLETED' | 'AWAITING_REVIEW';
  completedAtIso: string | null;
  idempotencyKey: string;
}

const seedImportJobWithPayload = async (
  pool: import('pg').Pool,
  opts: SeedOpts,
): Promise<void> => {
  await pool.query(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run, completed_at
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false,$11)`,
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
      opts.completedAtIso,
    ],
  );
  await pool.query(
    `INSERT INTO import_job_payloads (
      job_id, source_id, user_id, source_type, external_message_id, received_at,
      original_filename, mime_type, content_bytes_ref, content_hash, correlation_id,
      dry_run, virus_scan_status
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,NOW(),$5,$6,$7,$8,$9,false,'CLEAN')`,
    [
      opts.jobId,
      `src-${opts.jobId}`,
      opts.userId,
      `ext-${opts.jobId}`,
      `file-${opts.jobId}.pdf`,
      'application/pdf',
      `gs://bucket/${opts.jobId}`,
      `hash-${opts.jobId}`,
      `corr-${opts.jobId}`,
    ],
  );
};

describe('retentionService', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mkUser = async (suffix: string) => {
    const helpers = require('./helpers') as typeof import('./helpers');
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Retention',
      lastName: 'Test',
      email: `retention-${suffix}@example.com`,
      password: 'secret123',
    });
    return userId;
  };

  it('deletes import_job_payloads for DEAD_LETTERED jobs completed before the cutoff and preserves everything else', async () => {
    const { poolClient, getCurrentDbProvider } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    expect(getCurrentDbProvider()).toBe('memory');
    const userId = await mkUser('mixed');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    const DAY = 24 * 60 * 60 * 1000;
    const oldCompletedAt = new Date(now.getTime() - 120 * DAY).toISOString(); // 120 days ago
    const recentCompletedAt = new Date(now.getTime() - 10 * DAY).toISOString(); // 10 days ago

    await seedImportJobWithPayload(pool, {
      jobId: '11111111-1111-1111-1111-111111111111',
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      completedAtIso: oldCompletedAt,
      idempotencyKey: 'dl-old',
    });
    await seedImportJobWithPayload(pool, {
      jobId: '22222222-2222-2222-2222-222222222222',
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      completedAtIso: recentCompletedAt,
      idempotencyKey: 'dl-recent',
    });
    await seedImportJobWithPayload(pool, {
      jobId: '33333333-3333-3333-3333-333333333333',
      userId,
      ingestionSourceId: sourceId,
      state: 'COMPLETED',
      completedAtIso: oldCompletedAt,
      idempotencyKey: 'done-old',
    });
    await seedImportJobWithPayload(pool, {
      jobId: '44444444-4444-4444-4444-444444444444',
      userId,
      ingestionSourceId: sourceId,
      state: 'AWAITING_REVIEW',
      completedAtIso: null,
      idempotencyKey: 'active',
    });

    const result = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(result.deadLetterPayloadsDeleted).toBe(1);

    // Only the old-dead-lettered payload is gone; parent job row is kept.
    const payloads = await pool.query<{ job_id: string }>(
      'SELECT job_id FROM import_job_payloads ORDER BY job_id',
    );
    const remainingPayloadIds = payloads.rows.map((r) => r.job_id);
    expect(remainingPayloadIds).toEqual([
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    ]);

    const jobs = await pool.query<{ id: string }>(
      `SELECT id FROM import_jobs ORDER BY id`,
    );
    const remainingJobIds = jobs.rows.map((r) => r.id);
    expect(remainingJobIds).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    ]);
  });

  it('returns deadLetterPayloadsDeleted=0 when no jobs are eligible', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('none');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    await seedImportJobWithPayload(pool, {
      jobId: '55555555-5555-5555-5555-555555555555',
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      completedAtIso: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      idempotencyKey: 'dl-fresh',
    });

    const result = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(result.deadLetterPayloadsDeleted).toBe(0);
  });

  it('is idempotent — running twice deletes the same rows only once', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('idempotent');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    const oldCompletedAt = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await seedImportJobWithPayload(pool, {
      jobId: '66666666-6666-6666-6666-666666666666',
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      completedAtIso: oldCompletedAt,
      idempotencyKey: 'dl-very-old',
    });

    const first = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(first.deadLetterPayloadsDeleted).toBe(1);

    const second = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(second.deadLetterPayloadsDeleted).toBe(0);
  });

  it('honors a custom retentionDays override on a per-call basis', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('custom');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    // 10 days old — under the default 90-day window, but above a 5-day override.
    const completedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await seedImportJobWithPayload(pool, {
      jobId: '77777777-7777-7777-7777-777777777777',
      userId,
      ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED',
      completedAtIso: completedAt,
      idempotencyKey: 'dl-10d',
    });

    const defaultRun = await service.runRetentionTick({ now });
    expect(defaultRun.deadLetterPayloadsDeleted).toBe(0);

    const tightRun = await service.runRetentionTick({ now, retentionDays: 5 });
    expect(tightRun.deadLetterPayloadsDeleted).toBe(1);
  });

  // ─── Normalized-text tombstone rule (Priority 15 step 2) ─────────────────

  const seedIngestedDocument = async (
    pool: import('pg').Pool,
    opts: {
      docId: string;
      jobId: string;
      userId: string;
      normalizedText: string;
      normalizedHtml?: string | null;
    },
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO ingested_documents (
        id, import_job_id, user_id, source_type, content_hash, normalized_content_hash,
        mime_type, original_filename, raw_source_reference, content_bytes_ref,
        normalized_text, normalized_html, virus_scan_status
      ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,'application/pdf',$6,$7,$8,$9,$10,'CLEAN')`,
      [
        opts.docId,
        opts.jobId,
        opts.userId,
        `ch-${opts.docId}`,
        `nch-${opts.docId}`,
        `file-${opts.docId}.pdf`,
        `ref-${opts.docId}`,
        `gs://bucket/${opts.docId}`,
        opts.normalizedText,
        opts.normalizedHtml ?? null,
      ],
    );
  };

  it('tombstones normalized_text/html for COMPLETED jobs past the retention window, preserving rows + stamping deleted_raw_at', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('tombstone');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    const oldIso = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const recentIso = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Completed + old → eligible
    await seedImportJobWithPayload(pool, {
      jobId: '88888888-8888-8888-8888-888888888888', userId, ingestionSourceId: sourceId,
      state: 'COMPLETED', completedAtIso: oldIso, idempotencyKey: 'tb-old',
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000001',
      jobId: '88888888-8888-8888-8888-888888888888',
      userId, normalizedText: 'LARGE BODY TEXT', normalizedHtml: '<p>LARGE</p>',
    });

    // Completed + recent → NOT eligible
    await seedImportJobWithPayload(pool, {
      jobId: '99999999-9999-9999-9999-999999999999', userId, ingestionSourceId: sourceId,
      state: 'COMPLETED', completedAtIso: recentIso, idempotencyKey: 'tb-recent',
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000002',
      jobId: '99999999-9999-9999-9999-999999999999',
      userId, normalizedText: 'RECENT BODY', normalizedHtml: '<p>RECENT</p>',
    });

    const result = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(result.normalizedTextTombstoned).toBe(1);

    const { rows } = await pool.query<{ id: string; normalized_text: string; normalized_html: string | null; deleted_raw_at: string | null }>(
      `SELECT id, normalized_text, normalized_html, deleted_raw_at FROM ingested_documents ORDER BY id`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['aa000000-0000-0000-0000-000000000001'].normalized_text).toBe('');
    expect(byId['aa000000-0000-0000-0000-000000000001'].normalized_html).toBeNull();
    expect(byId['aa000000-0000-0000-0000-000000000001'].deleted_raw_at).not.toBeNull();
    // Recent one untouched.
    expect(byId['aa000000-0000-0000-0000-000000000002'].normalized_text).toBe('RECENT BODY');
    expect(byId['aa000000-0000-0000-0000-000000000002'].deleted_raw_at).toBeNull();
  });

  it('skips documents already tombstoned (deleted_raw_at set) so the sweep is idempotent', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('tombstone-idempotent');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    const oldIso = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();

    await seedImportJobWithPayload(pool, {
      jobId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: oldIso, idempotencyKey: 'tb-idem',
    });
    await seedIngestedDocument(pool, {
      docId: 'cc000000-0000-0000-0000-000000000001',
      jobId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId, normalizedText: 'BODY', normalizedHtml: null,
    });

    const first = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(first.normalizedTextTombstoned).toBe(1);

    const second = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(second.normalizedTextTombstoned).toBe(0);
  });

  // ─── Audit log entry per tick (Priority 15) ──────────────────────────────

  it('writes a RETENTION_TICK_RUN audit entry on every tick — even no-op ticks — with the cutoff + counts in after_state', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const pool = poolClient();
    const now = new Date('2026-04-23T12:00:00Z');
    const result = await service.runRetentionTick({ now, retentionDays: 90 });
    expect(result.deadLetterPayloadsDeleted).toBe(0);
    expect(result.normalizedTextTombstoned).toBe(0);

    const { rows } = await pool.query<{ action: string; after_state: string | null; actor_user_id: string | null }>(
      `SELECT action, after_state, actor_user_id FROM audit_log WHERE action = 'RETENTION_TICK_RUN' ORDER BY created_at DESC`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].actor_user_id).toBeNull();
    const payload = typeof rows[0].after_state === 'string' ? JSON.parse(rows[0].after_state) : rows[0].after_state;
    expect(payload).toMatchObject({
      cutoffIso: expect.any(String),
      retentionDays: 90,
      deadLetterPayloadsDeleted: 0,
      normalizedTextTombstoned: 0,
    });
  });

  it('captures non-zero counts in the audit entry when the sweep actually removed rows', async () => {
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const service = require('../src/services/retentionService') as typeof import('../src/services/retentionService');

    const userId = await mkUser('audit-counts');
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const now = new Date('2026-04-23T12:00:00Z');
    const oldIso = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    await seedImportJobWithPayload(pool, {
      jobId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: oldIso, idempotencyKey: 'audit-counts',
    });

    await service.runRetentionTick({ now, retentionDays: 90 });

    const { rows } = await pool.query<{ after_state: string | null }>(
      `SELECT after_state FROM audit_log WHERE action = 'RETENTION_TICK_RUN' ORDER BY created_at DESC LIMIT 1`,
    );
    const payload = typeof rows[0].after_state === 'string' ? JSON.parse(rows[0].after_state) : rows[0].after_state;
    expect(payload.deadLetterPayloadsDeleted).toBe(1);
  });
});
