import crypto from 'crypto';
import path from 'path';

const MAILGUN_SIGNING_KEY = 'test-mailgun-signing-key';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  process.env.MAILGUN_WEBHOOK_SIGNING_KEY = MAILGUN_SIGNING_KEY;
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const signMailgunWebhook = (timestamp: string, token: string): string =>
  crypto.createHmac('sha256', MAILGUN_SIGNING_KEY).update(`${timestamp}${token}`).digest('hex');

describe('ingestion Mailgun webhook', () => {
  const fixturePath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'golden', ...parts);

  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_forwarded_mailbox', true, null);
  });

  it('ingests a signed Mailgun body-only webhook for a premium user', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Mail', lastName: 'Body', email: 'mailgun-body@example.com', password: 'secret123' };
    const { token: authToken, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'mailgun-token-body';
    const signature = signMailgunWebhook(timestamp, token);

    await request(app)
      .post('/api/ingestion/webhooks/mailgun')
      .type('form')
      .send({
        timestamp,
        token,
        signature,
        sender: user.email,
        from: `Mail Body <${user.email}>`,
        recipient: 'travel.docs@duerk.org',
        subject: 'Forwarded Flight Confirmation',
        'Message-Id': '<mailgun-body-1@example.com>',
        Date: 'Fri, 04 Jul 2026 09:30:00 +0000',
        'body-plain':
          'Subject: Flight confirmation\nTraveler: Bryan Duerk\nAirline: Delta Airlines\nFlight Number: DL123\nConfirmation Code: ABC123\nDeparture: 2026-07-04 09:30\nFrom: Boston\nTo: San Francisco',
      })
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set({ Authorization: `Bearer ${authToken}` });
      return (review.body.items ?? []).length === 1;
    });

    const reviewRes = await request(app)
      .get('/api/ingestion/review-items')
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);

    expect(reviewRes.body.items).toHaveLength(1);
    expect(reviewRes.body.items[0].sourceType).toBe('FORWARDED_MAILBOX');
  });

  it('ingests Mailgun attachments through the shared pipeline', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Mail', lastName: 'Attachment', email: 'mailgun-attachment@example.com', password: 'secret123' };
    const { token: authToken, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'mailgun-token-attachment';
    const signature = signMailgunWebhook(timestamp, token);

    await request(app)
      .post('/api/ingestion/webhooks/mailgun')
      .field('timestamp', timestamp)
      .field('token', token)
      .field('signature', signature)
      .field('sender', user.email)
      .field('from', `Mail Attachment <${user.email}>`)
      .field('recipient', 'travel.docs@duerk.org')
      .field('subject', 'Forwarded Hotel Confirmation')
      .field('Message-Id', '<mailgun-attachment-1@example.com>')
      .attach('attachment-1', fixturePath('html-booking-confirmation.html'))
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set({ Authorization: `Bearer ${authToken}` });
      return (review.body.items ?? []).length === 1;
    });

    const reviewRes = await request(app)
      .get('/api/ingestion/review-items')
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);

    expect(reviewRes.body.items).toHaveLength(1);
    expect(reviewRes.body.items[0].sourceType).toBe('FORWARDED_MAILBOX');
    expect(reviewRes.body.items[0].itemType).toBe('hotel');
  });

  it('rejects invalid Mailgun signatures', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Mail', lastName: 'Invalid', email: 'mailgun-invalid@example.com', password: 'secret123' };
    const { userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'mailgun-token-invalid';

    await request(app)
      .post('/api/ingestion/webhooks/mailgun')
      .type('form')
      .send({
        timestamp,
        token,
        signature: 'not-valid',
        sender: user.email,
        from: `Mail Invalid <${user.email}>`,
        recipient: 'travel.docs@duerk.org',
        subject: 'Broken Signature',
        'Message-Id': '<mailgun-invalid-1@example.com>',
        'body-plain': 'Traveler: Test User',
      })
      .expect(406);
  });

  it('rejects replayed Mailgun webhook tokens', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const user = { firstName: 'Mail', lastName: 'Replay', email: 'mailgun-replay@example.com', password: 'secret123' };
    const { token: authToken, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'mailgun-token-replay';
    const signature = signMailgunWebhook(timestamp, token);
    const body = {
      timestamp,
      token,
      signature,
      sender: user.email,
      from: `Mail Replay <${user.email}>`,
      recipient: 'travel.docs@duerk.org',
      subject: 'Replay Check',
      'Message-Id': '<mailgun-replay-1@example.com>',
      'body-plain': 'Traveler: Replay User\nHotel Name: Harbor View Hotel\nCheck-in: July 10, 2026\nConfirmation Number: HVH889',
    };

    await request(app).post('/api/ingestion/webhooks/mailgun').type('form').send(body).expect(202);
    await request(app).post('/api/ingestion/webhooks/mailgun').type('form').send(body).expect(406);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set({ Authorization: `Bearer ${authToken}` });
      return (review.body.items ?? []).length === 1;
    });

    const reviewRes = await request(app)
      .get('/api/ingestion/review-items')
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);
    expect(reviewRes.body.items).toHaveLength(1);

    const jobsRes = await request(app)
      .get('/api/ingestion/jobs')
      .set({ Authorization: `Bearer ${authToken}` })
      .expect(200);
    expect(jobsRes.body.jobs).toHaveLength(1);
  });
});
