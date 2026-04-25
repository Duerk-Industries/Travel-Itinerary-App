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

const waitForJobState = async (
  repo: typeof import('../src/ingestion/shared/repository'),
  jobId: string,
  desired: 'running' | 'succeeded' | 'failed',
  timeoutMs = 2000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await repo.getDataDeletionJob(jobId);
    if (job?.state === desired) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  const latest = await repo.getDataDeletionJob(jobId);
  throw new Error(
    `Timed out waiting for job ${jobId} to reach ${desired}; final state=${latest?.state ?? 'missing'}`,
  );
};

describe('data deletion jobs', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_gmail_import', true, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a succeeded job row on synchronous disconnect and exposes jobId in the response', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const user = {
      firstName: 'Sync',
      lastName: 'Delete',
      email: 'sync-delete@example.com',
      password: 'secret123',
    };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    await repo.upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'sync-access',
      refreshToken: 'sync-refresh',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { email: user.email },
    });
    await repo.getOrCreateIngestionSource(userId, 'GMAIL_IMPORT');

    const res = await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(res.body.disconnected).toBe(true);
    expect(res.body.deletion).toEqual(expect.objectContaining({ sourcesDeleted: 1 }));
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);

    const job = await repo.getDataDeletionJob(res.body.jobId);
    expect(job).not.toBeNull();
    expect(job?.state).toBe('succeeded');
    expect(job?.provider).toBe('gmail');
    expect(job?.userId).toBe(userId);
    expect(job?.counts).toEqual(expect.objectContaining({ sourcesDeleted: 1 }));
    expect(job?.startedAt).not.toBeNull();
    expect(job?.completedAt).not.toBeNull();
    expect(job?.failureReason).toBeNull();
  });

  it('returns 202 with a pending jobId when called with ?async=1 and completes in the background', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const user = {
      firstName: 'Async',
      lastName: 'Delete',
      email: 'async-delete@example.com',
      password: 'secret123',
    };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'pro');

    await repo.upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'async-access',
      refreshToken: 'async-refresh',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { email: user.email },
    });
    await repo.getOrCreateIngestionSource(userId, 'GMAIL_IMPORT');

    const res = await request(app)
      .post('/api/ingestion/gmail/disconnect?async=1')
      .set({ Authorization: `Bearer ${token}` })
      .expect(202);

    expect(res.body.queued).toBe(true);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.state).toBe('pending');

    const finished = await waitForJobState(repo, res.body.jobId, 'succeeded');
    expect(finished.counts).toEqual(expect.objectContaining({ sourcesDeleted: 1 }));

    // Provider connection should have been removed in the background.
    expect(await repo.getProviderConnection(userId, 'gmail')).toBeNull();
  });

  it('GET /api/ingestion/data-deletion-jobs lists the caller’s own jobs only', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const userA = {
      firstName: 'Deleter',
      lastName: 'Alpha',
      email: 'ddj-user-a@example.com',
      password: 'secret123',
    };
    const userB = {
      firstName: 'Deleter',
      lastName: 'Bravo',
      email: 'ddj-user-b@example.com',
      password: 'secret123',
    };
    const a = await helpers.registerAndLoginWebUser(userA);
    const b = await helpers.registerAndLoginWebUser(userB);

    const jobA = await repo.createDataDeletionJob(a.userId, 'gmail');
    const jobB = await repo.createDataDeletionJob(b.userId, 'gmail');

    const res = await request(app)
      .get('/api/ingestion/data-deletion-jobs')
      .set({ Authorization: `Bearer ${a.token}` })
      .expect(200);

    const ids = (res.body.jobs as Array<{ id: string }>).map((j) => j.id);
    expect(ids).toContain(jobA.id);
    expect(ids).not.toContain(jobB.id);
  });

  it('GET /api/admin/data-deletion-jobs requires admin and supports state filtering', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const admin = await helpers.makeAdminUser({
      firstName: 'Admin',
      lastName: 'Person',
      email: 'ddj-admin@example.com',
      password: 'secret123',
    });
    const regular = await helpers.registerAndLoginWebUser({
      firstName: 'Regular',
      lastName: 'User',
      email: 'ddj-regular@example.com',
      password: 'secret123',
    });

    // Non-admin should be blocked.
    await request(app)
      .get('/api/admin/data-deletion-jobs')
      .set({ Authorization: `Bearer ${regular.token}` })
      .expect(403);

    const pendingJob = await repo.createDataDeletionJob(regular.userId, 'gmail');
    const failedJob = await repo.createDataDeletionJob(regular.userId, 'gmail');
    await repo.markDataDeletionJobFailed(failedJob.id, 'test failure');

    const allRes = await request(app)
      .get('/api/admin/data-deletion-jobs')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);
    const allIds = (allRes.body.jobs as Array<{ id: string }>).map((j) => j.id);
    expect(allIds).toEqual(expect.arrayContaining([pendingJob.id, failedJob.id]));

    const failedRes = await request(app)
      .get('/api/admin/data-deletion-jobs?state=failed')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(200);
    const failedIds = (failedRes.body.jobs as Array<{ id: string; state: string }>).map((j) => j.id);
    expect(failedIds).toContain(failedJob.id);
    expect(failedIds).not.toContain(pendingJob.id);

    await request(app)
      .get('/api/admin/data-deletion-jobs?state=not-a-real-state')
      .set({ Authorization: `Bearer ${admin.token}` })
      .expect(400);
  });

  it('leaves the provider connection intact and records a failed job when the cascade throws', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const user = {
      firstName: 'Failure',
      lastName: 'Case',
      email: 'ddj-failure@example.com',
      password: 'secret123',
    };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    await repo.upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'fail-access',
      refreshToken: 'fail-refresh',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { email: user.email },
    });

    jest.spyOn(repo, 'deleteUserIngestionDataForProvider').mockRejectedValueOnce(
      new Error('simulated cascade failure'),
    );

    const res = await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(500);

    expect(res.body.error).toBeDefined();
    expect(typeof res.body.jobId).toBe('string');

    // Provider connection should still be present (retryable).
    const connection = await repo.getProviderConnection(userId, 'gmail');
    expect(connection).not.toBeNull();

    const job = await repo.getDataDeletionJob(res.body.jobId);
    expect(job?.state).toBe('failed');
    expect(job?.failureReason).toContain('simulated cascade failure');
  });
});
