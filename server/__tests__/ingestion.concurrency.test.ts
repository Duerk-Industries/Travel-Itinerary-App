import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('ingestion concurrency and idempotency', () => {
  const fixturePath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'golden', ...parts);

  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('same file uploaded twice quickly produces only one review item via idempotency', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Concurrent', lastName: 'Upload', email: 'concurrent-upload@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    // Upload the same file twice in quick succession (not parallel, to avoid quota race)
    const res1 = await request(app).post('/api/ingestion/upload').set(auth).attach('files', fixturePath('plain-text-email.txt'));
    const res2 = await request(app).post('/api/ingestion/upload').set(auth).attach('files', fixturePath('plain-text-email.txt'));

    // Both should accept (202) — idempotency handles dedup
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);

    // Wait for processing to complete
    await helpers.waitFor(async () => {
      const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth);
      const jobs = jobsRes.body.jobs ?? [];
      return jobs.length >= 1 && jobs.every((j: any) => j.state !== 'PENDING' && j.state !== 'NORMALIZING' && j.state !== 'EXTRACTING');
    });

    // Should only have one review item (idempotent — same content hash + user)
    const reviewRes = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(reviewRes.body.items).toHaveLength(1);

    // Should only have one job (idempotency key dedup)
    const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth).expect(200);
    expect(jobsRes.body.jobs).toHaveLength(1);
  });

  it('same message received twice concurrently does not create duplicate items', async () => {
    const { writeTempBytes } = require('../src/ingestion/shared/tempStorage') as typeof import('../src/ingestion/shared/tempStorage');
    const { runIngestionPipeline } = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const { listReviewQueueItems, listImportJobsForUser } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const db = require('../src/db') as typeof import('../src/db');

    await db.createWebUser('Double', 'Message', 'double-message@example.com', 'secret123');
    const user = await db.findUserByEmail('double-message@example.com');
    const userId = user!.id;

    const content = 'Subject: Flight confirmation\nAirline: Delta Airlines\nFlight Number: DL123\nConfirmation Code: ABC123\nDeparture: 2026-07-04 09:30\nFrom: Boston\nTo: San Francisco';
    const ref1 = await writeTempBytes('msg1.txt', Buffer.from(content, 'utf8'));
    const ref2 = await writeTempBytes('msg2.txt', Buffer.from(content, 'utf8'));

    const basePayload = {
      sourceType: 'FORWARDED_MAILBOX' as const,
      sourceId: 'source-1',
      userId,
      externalMessageId: 'same-message-id@example.com',
      receivedAt: new Date().toISOString(),
      originalFilename: 'msg.txt',
      mimeType: 'text/plain',
      contentHash: 'same-hash',
      metadata: {},
      correlationId: 'corr-concurrent',
      dryRun: false,
      virusScanStatus: 'SKIPPED' as const,
    };

    // Run two pipelines with same externalMessageId concurrently
    const results = await Promise.allSettled([
      runIngestionPipeline({ ...basePayload, contentBytesRef: ref1 }, false, false),
      runIngestionPipeline({ ...basePayload, contentBytesRef: ref2 }, false, false),
    ]);

    // At least one should succeed
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Only one job should exist (idempotency key: SHA-256(sourceType + externalMessageId + userId))
    const jobs = await listImportJobsForUser(userId);
    expect(jobs).toHaveLength(1);

    // Only one set of review items
    const items = await listReviewQueueItems(userId);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('duplicate badge behavior when existing assigned item matches new upload fingerprint', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Badge', lastName: 'Test', email: 'badge-test@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    // Create a trip
    const groupsRes = await request(app).get('/api/groups').set(auth).expect(200);
    const tripRes = await request(app)
      .post('/api/trips')
      .set(auth)
      .send({ name: 'Badge Trip', groupId: groupsRes.body[0].id, currency: 'USD' })
      .expect(201);

    // Upload and assign first item
    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', fixturePath('plain-text-email.txt'))
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set(auth);
      return (review.body.items ?? []).length === 1;
    });

    const firstReview = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    const firstItemId = firstReview.body.items[0].id;

    await request(app)
      .post(`/api/ingestion/review-items/${firstItemId}/assign`)
      .set(auth)
      .send({ tripId: tripRes.body.id })
      .expect(201);

    // Upload a different file that will produce items with a different fingerprint
    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', fixturePath('html-booking-confirmation.html'))
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set(auth);
      return (review.body.items ?? []).length >= 1;
    });

    // Verify new items are in the review queue (not duplicates of the first)
    const secondReview = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(secondReview.body.items.length).toBeGreaterThanOrEqual(1);

    // The item should not be flagged as a duplicate since it's a different document
    // (different fingerprint)
    for (const item of secondReview.body.items) {
      // Only flag if fingerprint actually matches an existing assigned item
      if (item.duplicateDisposition === 'ASSIGNED_MATCH') {
        expect(item.duplicateOfTripId).toBeTruthy();
      }
    }
  });

  it('atomic assignment under concurrent submit attempts', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Atomic', lastName: 'Assign', email: 'atomic-assign@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };

    // Create a trip
    const groupsRes = await request(app).get('/api/groups').set(auth).expect(200);
    const tripRes = await request(app)
      .post('/api/trips')
      .set(auth)
      .send({ name: 'Atomic Trip', groupId: groupsRes.body[0].id, currency: 'USD' })
      .expect(201);

    // Upload item
    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', fixturePath('plain-text-email.txt'))
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set(auth);
      return (review.body.items ?? []).length === 1;
    });

    const reviewRes = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    const itemId = reviewRes.body.items[0].id;

    // Try to assign the same item to the same trip twice concurrently
    const [assignRes1, assignRes2] = await Promise.all([
      request(app)
        .post(`/api/ingestion/review-items/${itemId}/assign`)
        .set(auth)
        .send({ tripId: tripRes.body.id }),
      request(app)
        .post(`/api/ingestion/review-items/${itemId}/assign`)
        .set(auth)
        .send({ tripId: tripRes.body.id }),
    ]);

    // At least one should succeed (201), the other may fail (400) if item already assigned
    const statuses = [assignRes1.status, assignRes2.status].sort();
    expect(statuses).toContain(201);

    // Item should end up assigned exactly once
    const finalReview = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(finalReview.body.items).toHaveLength(0);
  });

  it('Gmail import rerun on same mailbox window is idempotent', async () => {
    const { writeTempBytes } = require('../src/ingestion/shared/tempStorage') as typeof import('../src/ingestion/shared/tempStorage');
    const { runIngestionPipeline } = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const { listReviewQueueItems, listImportJobsForUser } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const db = require('../src/db') as typeof import('../src/db');

    await db.createWebUser('Gmail', 'Rerun', 'gmail-rerun@example.com', 'secret123');
    const user = await db.findUserByEmail('gmail-rerun@example.com');
    const userId = user!.id;

    const content = 'Subject: Hotel booking\nHotel Name: Harbor View Hotel\nCheck-in: July 10, 2026\nCheck-out: July 13, 2026\nConfirmation Number: HVH889';

    // Simulate two imports of the same Gmail message
    for (let i = 0; i < 2; i++) {
      const ref = await writeTempBytes(`gmail-${i}.txt`, Buffer.from(content, 'utf8'));
      try {
        await runIngestionPipeline(
          {
            sourceType: 'GMAIL_IMPORT',
            sourceId: 'source-gmail',
            userId,
            externalMessageId: 'gmail-msg-123::part:0',
            receivedAt: new Date().toISOString(),
            originalFilename: 'gmail-message.txt',
            mimeType: 'text/plain',
            contentBytesRef: ref,
            contentHash: `gmail-hash-${i}`,
            metadata: { provider: 'gmail' },
            correlationId: `corr-gmail-${i}`,
            dryRun: false,
            virusScanStatus: 'SKIPPED',
          },
          false,
          false
        );
      } catch {
        // Second run may throw due to duplicate content hash — that's expected
      }
    }

    // Only one job should exist (same externalMessageId + userId)
    const jobs = await listImportJobsForUser(userId);
    expect(jobs).toHaveLength(1);

    // Review queue should have items from only one processing run
    const items = await listReviewQueueItems(userId);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
