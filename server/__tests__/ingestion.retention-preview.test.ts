/// <reference types="jest" />
/// <reference types="node" />
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const seedImportJobWithPayload = async (
  pool: import('pg').Pool,
  opts: {
    jobId: string;
    userId: string;
    ingestionSourceId: string;
    state: 'DEAD_LETTERED' | 'COMPLETED' | 'AWAITING_REVIEW';
    completedAtIso: string | null;
    idempotencyKey: string;
    withPayload?: boolean;
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO import_jobs (
      id, user_id, ingestion_source_id, source_type, state, idempotency_key, content_hash,
      external_message_id, original_filename, mime_type, correlation_id, dry_run, completed_at
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,$6,$7,$8,$9,$10,false,$11)`,
    [
      opts.jobId, opts.userId, opts.ingestionSourceId, opts.state, opts.idempotencyKey,
      `h-${opts.jobId}`, `e-${opts.jobId}`, `f-${opts.jobId}.pdf`, 'application/pdf',
      `c-${opts.jobId}`, opts.completedAtIso,
    ],
  );
  if (opts.withPayload !== false) {
    await pool.query(
      `INSERT INTO import_job_payloads (
        job_id, source_id, user_id, source_type, external_message_id, received_at,
        original_filename, mime_type, content_bytes_ref, content_hash, correlation_id,
        dry_run, virus_scan_status
      ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,NOW(),$5,$6,$7,$8,$9,false,'CLEAN')`,
      [
        opts.jobId, `src-${opts.jobId}`, opts.userId, `e-${opts.jobId}`,
        `f-${opts.jobId}.pdf`, 'application/pdf',
        `gs://bucket/${opts.jobId}`, `h-${opts.jobId}`, `c-${opts.jobId}`,
      ],
    );
  }
};

const seedIngestedDocument = async (
  pool: import('pg').Pool,
  opts: { docId: string; jobId: string; userId: string; alreadyTombstoned?: boolean },
): Promise<void> => {
  await pool.query(
    `INSERT INTO ingested_documents (
      id, import_job_id, user_id, source_type, content_hash, normalized_content_hash,
      mime_type, original_filename, raw_source_reference, content_bytes_ref,
      normalized_text, normalized_html, virus_scan_status, deleted_raw_at
    ) VALUES ($1,$2,$3,'MANUAL_UPLOAD',$4,$5,'application/pdf',$6,$7,$8,$9,$10,'CLEAN',$11)`,
    [
      opts.docId, opts.jobId, opts.userId,
      `ch-${opts.docId}`, `nch-${opts.docId}`,
      `f-${opts.docId}.pdf`, `ref-${opts.docId}`, `gs://bucket/${opts.docId}`,
      'BODY', '<p>BODY</p>',
      opts.alreadyTombstoned ? new Date().toISOString() : null,
    ],
  );
};

describe('GET /api/admin/ingestion/retention-preview', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_admin_observability', true, null);
  });

  it('counts DEAD_LETTERED payloads + terminal-state normalized_text past the window, ignoring recent rows', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const admin = await helpers.makeAdminUser({
      firstName: 'Retention', lastName: 'Admin',
      email: `retention-admin-${Date.now()}@example.com`, password: 'secret123',
    });
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Owner', lastName: 'Test',
      email: `retention-owner-${Date.now()}@example.com`, password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();
    const DAY = 24 * 60 * 60 * 1000;
    const oldIso = new Date(Date.now() - 120 * DAY).toISOString();
    const recentIso = new Date(Date.now() - 10 * DAY).toISOString();

    // Old dead-letter with payload → eligible payload + normalized_text.
    await seedImportJobWithPayload(pool, {
      jobId: '11111111-1111-1111-1111-111111111111', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: oldIso, idempotencyKey: 'dl-old',
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000001',
      jobId: '11111111-1111-1111-1111-111111111111', userId,
    });

    // Old completed → eligible normalized_text only (no payload).
    await seedImportJobWithPayload(pool, {
      jobId: '22222222-2222-2222-2222-222222222222', userId, ingestionSourceId: sourceId,
      state: 'COMPLETED', completedAtIso: oldIso, idempotencyKey: 'done-old',
      withPayload: false,
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000002',
      jobId: '22222222-2222-2222-2222-222222222222', userId,
    });

    // Recent dead-letter → not eligible.
    await seedImportJobWithPayload(pool, {
      jobId: '33333333-3333-3333-3333-333333333333', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: recentIso, idempotencyKey: 'dl-recent',
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000003',
      jobId: '33333333-3333-3333-3333-333333333333', userId,
    });

    // Old + already tombstoned → not eligible for normalized_text.
    await seedImportJobWithPayload(pool, {
      jobId: '44444444-4444-4444-4444-444444444444', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: oldIso, idempotencyKey: 'dl-tomb',
      withPayload: false,
    });
    await seedIngestedDocument(pool, {
      docId: 'aa000000-0000-0000-0000-000000000004',
      jobId: '44444444-4444-4444-4444-444444444444', userId,
      alreadyTombstoned: true,
    });

    const res = await request(app)
      .get('/api/admin/ingestion/retention-preview')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);

    expect(res.body.retentionDays).toBeGreaterThan(0);
    expect(typeof res.body.cutoffIso).toBe('string');
    expect(res.body.deadLetterPayloadsEligible).toBe(1);
    expect(res.body.normalizedTextEligible).toBe(2);
  });

  it('honors ?days=N to widen or narrow the window without mutating anything', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { poolClient } = require('../src/db') as typeof import('../src/db');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const admin = await helpers.makeAdminUser({
      firstName: 'Retention', lastName: 'AdminTwo',
      email: `retention-admin2-${Date.now()}@example.com`, password: 'secret123',
    });
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Owner', lastName: 'Two',
      email: `retention-owner2-${Date.now()}@example.com`, password: 'secret123',
    });
    const sourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');
    const pool = poolClient();

    const completedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await seedImportJobWithPayload(pool, {
      jobId: '55555555-5555-5555-5555-555555555555', userId, ingestionSourceId: sourceId,
      state: 'DEAD_LETTERED', completedAtIso: completedAt, idempotencyKey: 'dl-10d',
    });

    // Default 90 days → 10-day row not eligible.
    const defaultRes = await request(app)
      .get('/api/admin/ingestion/retention-preview')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);
    expect(defaultRes.body.deadLetterPayloadsEligible).toBe(0);

    // Narrower window (5 days) → the 10-day row IS eligible.
    const tightRes = await request(app)
      .get('/api/admin/ingestion/retention-preview?days=5')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);
    expect(tightRes.body.retentionDays).toBe(5);
    expect(tightRes.body.deadLetterPayloadsEligible).toBe(1);

    // Neither call should have mutated the payload row.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM import_job_payloads`,
    );
    expect(parseInt(rows[0].count, 10)).toBe(1);
  });

  it('returns 403 when the admin observability flag is off', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');

    const admin = await helpers.makeAdminUser({
      firstName: 'Admin', lastName: 'FlagOff',
      email: `retention-admin-flag-${Date.now()}@example.com`, password: 'secret123',
    });
    await db.setFeatureFlag('feature_ingest_admin_observability', false, null);

    await request(app)
      .get('/api/admin/ingestion/retention-preview')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(403);
  });
});
