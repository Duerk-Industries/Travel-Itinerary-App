import path from 'path';
import { INGESTION_MAX_FILE_BYTES } from '../src/ingestion/config';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('ingestion routes', () => {
  const fixturePath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'golden', ...parts);

  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
  });

  it('allows premium users to upload, review, edit, assign, and soft-delete items', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Prem', lastName: 'User', email: 'prem@example.com', password: 'secret123' };
    const secondUser = { firstName: 'Delete', lastName: 'User', email: 'delete@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    const { token: deleteToken, userId: deleteUserId } = await helpers.registerAndLoginWebUser(secondUser);
    await helpers.setUserTierInDb(userId, 'premium');
    await helpers.setUserTierInDb(deleteUserId, 'premium');
    const auth = { Authorization: `Bearer ${token}` };
    const deleteAuth = { Authorization: `Bearer ${deleteToken}` };

    const groupsRes = await request(app).get('/api/groups').set(auth).expect(200);
    const groupId = groupsRes.body[0].id;
    const tripRes = await request(app)
      .post('/api/trips')
      .set(auth)
      .send({ name: 'Rome Trip', groupId, currency: 'USD' })
      .expect(201);

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
    expect(reviewRes.body.items).toHaveLength(1);
    const itemId = reviewRes.body.items[0].id as string;

    await request(app)
      .patch(`/api/ingestion/review-items/${itemId}`)
      .set(auth)
      .send({ editedFields: { providerVendor: 'Edited Airlines', confirmationNumber: 'ZXCVB1', notes: 'Seat 14A' } })
      .expect(200);

    await request(app)
      .post(`/api/ingestion/review-items/${itemId}/assign`)
      .set(auth)
      .send({ tripId: tripRes.body.id, editedFields: { providerVendor: 'Edited Airlines' } })
      .expect(201);

    const queueAfterAssign = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(queueAfterAssign.body.items).toHaveLength(0);

    const messagesRes = await request(app).get(`/api/trips/${tripRes.body.id}/messages`).set(auth).expect(200);
    expect(messagesRes.body.messages.some((message: any) => String(message.body).includes('Imported flight'))).toBe(true);

    await request(app)
      .post('/api/ingestion/upload')
      .set(deleteAuth)
      .attach('files', fixturePath('html-booking-confirmation.html'))
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set(deleteAuth);
      return (review.body.items ?? []).length === 1;
    });

    const deleteQueue = await request(app).get('/api/ingestion/review-items').set(deleteAuth).expect(200);
    expect(deleteQueue.body.items).toHaveLength(1);
    await request(app).delete(`/api/ingestion/review-items/${deleteQueue.body.items[0].id}`).set(deleteAuth).expect(200);
    const deletedQueue = await request(app).get('/api/ingestion/review-items').set(deleteAuth).expect(200);
    expect(deletedQueue.body.items).toHaveLength(0);
  });

  it('denies free users from ingestion endpoints and suppresses duplicate uploads', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const freeUser = { firstName: 'Free', lastName: 'User', email: 'free@example.com', password: 'secret123' };
    const premiumUser = { firstName: 'Dupe', lastName: 'User', email: 'dupe@example.com', password: 'secret123' };
    const { token: freeToken } = await helpers.registerAndLoginWebUser(freeUser);
    const { token: premiumToken, userId: premiumUserId } = await helpers.registerAndLoginWebUser(premiumUser);
    await helpers.setUserTierInDb(premiumUserId, 'premium');

    await request(app)
      .post('/api/ingestion/upload')
      .set({ Authorization: `Bearer ${freeToken}` })
      .attach('files', fixturePath('plain-text-email.txt'))
      .expect(403);

    const auth = { Authorization: `Bearer ${premiumToken}` };
    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', fixturePath('plain-text-email.txt'))
      .expect(202);
    await request(app)
      .post('/api/ingestion/upload')
      .set(auth)
      .attach('files', fixturePath('plain-text-email.txt'))
      .expect(202);

    await helpers.waitFor(async () => {
      const jobsRes = await request(app).get('/api/ingestion/jobs').set(auth);
      return (jobsRes.body.jobs ?? []).length === 1 && (jobsRes.body.jobs[0]?.state === 'COMPLETED' || jobsRes.body.jobs[0]?.state === 'DUPLICATE_IGNORED');
    });

    const queue = await request(app).get('/api/ingestion/review-items').set(auth).expect(200);
    expect(queue.body.items).toHaveLength(1);
    const jobs = await request(app).get('/api/ingestion/jobs').set(auth).expect(200);
    expect(jobs.body.jobs).toHaveLength(1);
  });

  it('returns a clear 400 for unsupported manual upload file types', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Upload', lastName: 'Type', email: 'upload-type@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await request(app)
        .post('/api/ingestion/upload')
        .set({ Authorization: `Bearer ${token}` })
        .attach('files', Buffer.from('a,b,c\n1,2,3\n', 'utf8'), { filename: 'unsupported.csv', contentType: 'text/csv' })
        .expect(400);

      expect(res.body.code).toBe('unsupported_file_type');
      expect(String(res.body.error)).toContain('Unsupported file type');
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[ingestion][upload] rejected code=unsupported_file_type'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('"filename":"unsupported.csv"'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('"mimeType":"text/csv"'));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('returns a clear 400 for oversized manual uploads', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Upload', lastName: 'Size', email: 'upload-size@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const oversizedBuffer = Buffer.alloc(INGESTION_MAX_FILE_BYTES + 1, 0x20);
    const res = await request(app)
      .post('/api/ingestion/upload')
      .set({ Authorization: `Bearer ${token}` })
      .attach('files', oversizedBuffer, { filename: 'too-large.pdf', contentType: 'application/pdf' })
      .expect(400);

    expect(res.body.code).toBe('file_too_large');
    expect(String(res.body.error)).toContain('10MB');
  });

});
