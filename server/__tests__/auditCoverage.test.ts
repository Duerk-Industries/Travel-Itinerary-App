const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  process.env.GOOGLE_CLIENT_ID = 'gmail-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'gmail-client-secret';
  process.env.WEB_URL = 'http://localhost:8081';
  delete process.env.GOOGLE_GMAIL_CALLBACK_URL;
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('audit log coverage for privacy-sensitive routes', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_gmail_import', true, null);
    await db.setFeatureFlag('feature_ingest_admin_observability', true, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POST /api/ingestion/gmail/disconnect (sync) writes a GMAIL_DATA_DISCONNECTED audit entry with deletion counts', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Audit', lastName: 'Gmail', email: 'audit-gmail@example.com', password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    await repo.upsertProviderConnection({
      userId, provider: 'gmail',
      accessToken: 't', refreshToken: 'r',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['gmail.readonly'], metadata: {},
    });
    await repo.getOrCreateIngestionSource(userId, 'GMAIL_IMPORT');

    await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    const audit = await db.listAuditLog({ targetUserId: userId, action: 'GMAIL_DATA_DISCONNECTED' });
    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries[0];
    expect(entry.actorUserId).toBe(userId);
    expect(entry.targetUserId).toBe(userId);
    expect(entry.reason).toMatch(/sync/);
    expect((entry.afterState as any).mode).toBe('sync');
    expect((entry.afterState as any).deletion).toEqual(
      expect.objectContaining({ sourcesDeleted: expect.any(Number) }),
    );
  });

  it('POST /api/ingestion/gmail/disconnect (sync) records GMAIL_DATA_DISCONNECT_FAILED when the cascade throws', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Audit', lastName: 'Fail', email: 'audit-gmail-fail@example.com', password: 'secret123',
    });
    await helpers.setUserTierInDb(userId, 'premium');
    await repo.upsertProviderConnection({
      userId, provider: 'gmail',
      accessToken: 't', refreshToken: 'r',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['gmail.readonly'], metadata: {},
    });
    jest.spyOn(repo, 'deleteUserIngestionDataForProvider').mockRejectedValueOnce(
      new Error('simulated cascade failure'),
    );

    await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(500);

    const audit = await db.listAuditLog({ targetUserId: userId, action: 'GMAIL_DATA_DISCONNECT_FAILED' });
    expect(audit.entries).toHaveLength(1);
    expect((audit.entries[0].afterState as any).failureReason).toMatch(/simulated cascade failure/);
  });

  it('PATCH /api/account/password writes an ACCOUNT_PASSWORD_CHANGED audit entry with the mode', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');

    const user = { firstName: 'Audit', lastName: 'Pass', email: 'audit-pass@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);

    await request(app)
      .patch('/api/account/password')
      .set({ Authorization: `Bearer ${token}` })
      .send({ currentPassword: user.password, newPassword: 'newsecret', newPasswordConfirm: 'newsecret' })
      .expect(200);

    const audit = await db.listAuditLog({ targetUserId: userId, action: 'ACCOUNT_PASSWORD_CHANGED' });
    expect(audit.entries).toHaveLength(1);
    expect((audit.entries[0].afterState as any).mode).toBe('change');
    // The request body (including newPassword) must not leak into audit state.
    const serialized = JSON.stringify(audit.entries[0]);
    expect(serialized).not.toContain('newsecret');
  });

  it('POST /api/account/emails writes an ACCOUNT_EMAIL_ADDED audit entry', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');

    const { token, userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Audit', lastName: 'Email', email: 'audit-email@example.com', password: 'secret123',
    });

    await request(app)
      .post('/api/account/emails')
      .set({ Authorization: `Bearer ${token}` })
      .send({ email: 'secondary-audit@example.com' })
      .expect(201);

    const audit = await db.listAuditLog({ targetUserId: userId, action: 'ACCOUNT_EMAIL_ADDED' });
    expect(audit.entries).toHaveLength(1);
    expect((audit.entries[0].afterState as any).email).toBe('secondary-audit@example.com');
  });

  it('DELETE /api/account writes an ACCOUNT_DELETED audit entry before cascading (FK SET NULL nulls actor/target post-cascade)', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');

    const { token } = await helpers.registerAndLoginWebUser({
      firstName: 'Audit', lastName: 'Delete', email: 'audit-delete@example.com', password: 'secret123',
    });

    await request(app)
      .delete('/api/account')
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);

    // The account cascade nulls the FK; we match by the action string alone.
    const audit = await db.listAuditLog({ action: 'ACCOUNT_DELETED' });
    const entries = audit.entries.filter((e) => e.reason === 'User initiated account deletion');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // After the cascade the actor/target were set to null via ON DELETE SET NULL.
    const latest = entries[0];
    expect(latest.actorUserId).toBeNull();
    expect(latest.targetUserId).toBeNull();
    expect(latest.action).toBe('ACCOUNT_DELETED');
  });

  it('POST /api/admin/ingestion/dead-letter/re-drive writes an INGESTION_DEAD_LETTER_RE_DRIVEN audit entry with matched+retried counts', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const db = require('../src/db') as typeof import('../src/db');
    const queueMod = require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
    queueMod.resetJobQueueForTests();
    const queue = queueMod.getJobQueue();
    jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);

    const admin = await helpers.makeAdminUser({
      firstName: 'Audit', lastName: 'Admin', email: `audit-admin-${Date.now()}@example.com`, password: 'secret123',
    });

    await request(app)
      .post('/api/admin/ingestion/dead-letter/re-drive')
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ provider: 'ALL' })
      .expect(200);

    const audit = await db.listAuditLog({ action: 'INGESTION_DEAD_LETTER_RE_DRIVEN' });
    const entries = audit.entries.filter((e) => e.actorUserId === admin.userId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const latest = entries[0];
    expect((latest.beforeState as any).provider).toBe('ALL');
    expect((latest.beforeState as any).matched).toBe(0);
    expect((latest.afterState as any).retried).toBe(0);
  });
});
