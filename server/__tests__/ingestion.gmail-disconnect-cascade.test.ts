/// <reference types="jest" />
/// <reference types="node" />
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

describe('POST /api/ingestion/gmail/disconnect cascade', () => {
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

  it('removes Gmail ingestion_sources, import_jobs, and provider connection while leaving MANUAL_UPLOAD untouched', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const user = {
      firstName: 'Gmail',
      lastName: 'Disconnect',
      email: 'gmail-disconnect-cascade@example.com',
      password: 'secret123',
    };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    // Seed a Gmail provider_connection.
    const connectionId = await repo.upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      tokenExpiry: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { email: user.email },
    });
    expect(connectionId).toBeTruthy();

    // Seed one GMAIL_IMPORT and one MANUAL_UPLOAD ingestion source.
    const gmailSourceId = await repo.getOrCreateIngestionSource(userId, 'GMAIL_IMPORT');
    const manualSourceId = await repo.getOrCreateIngestionSource(userId, 'MANUAL_UPLOAD');

    // Create one import_job per source_type.
    const gmailJob = await repo.createImportJob({
      userId,
      ingestionSourceId: gmailSourceId,
      sourceType: 'GMAIL_IMPORT',
      idempotencyKey: 'gmail-key-1',
      contentHash: 'hash-gmail',
      externalMessageId: 'msg-gmail',
      originalFilename: 'gmail-booking.eml',
      mimeType: 'message/rfc822',
      correlationId: 'corr-gmail',
      dryRun: false,
    });
    const manualJob = await repo.createImportJob({
      userId,
      ingestionSourceId: manualSourceId,
      sourceType: 'MANUAL_UPLOAD',
      idempotencyKey: 'manual-key-1',
      contentHash: 'hash-manual',
      externalMessageId: 'msg-manual',
      originalFilename: 'manual.pdf',
      mimeType: 'application/pdf',
      correlationId: 'corr-manual',
      dryRun: false,
    });

    // Call the disconnect endpoint.
    const disconnectRes = await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(disconnectRes.body.disconnected).toBe(true);
    expect(disconnectRes.body.deletion).toEqual(
      expect.objectContaining({
        sourcesDeleted: 1,
        jobsDeleted: 1,
      }),
    );

    // Gmail connection is gone.
    expect(await repo.getProviderConnection(userId, 'gmail')).toBeNull();

    // Listing jobs should return only the MANUAL job.
    const remainingJobs = await repo.listImportJobsForUser(userId);
    const jobIds = remainingJobs.map((j: any) => j.id);
    expect(jobIds).toContain(manualJob.id);
    expect(jobIds).not.toContain(gmailJob.id);

    // A second disconnect call is a no-op (idempotent) and returns zero counts.
    const secondRes = await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(secondRes.body.deletion).toEqual({
      sourcesDeleted: 0,
      jobsDeleted: 0,
      documentsDeleted: 0,
      parsedItemsDeleted: 0,
    });
  });

  it('returns zeroed counts for providers with no ingestion mapping', async () => {
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = {
      firstName: 'No',
      lastName: 'Mapping',
      email: 'no-ingestion-mapping@example.com',
      password: 'secret123',
    };
    const { userId } = await helpers.registerAndLoginWebUser(user);
    const counts = await repo.deleteUserIngestionDataForProvider(userId, 'some-provider-we-do-not-ingest');
    expect(counts).toEqual({
      sourcesDeleted: 0,
      jobsDeleted: 0,
      documentsDeleted: 0,
      parsedItemsDeleted: 0,
    });
  });
});
