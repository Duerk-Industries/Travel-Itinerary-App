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

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

describe('ingestion Gmail routes', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    jest.doMock('../src/ai/services/shadowParseService', () => ({
      maybeRunShadowParse: jest.fn(async () => undefined),
      __shadowParseShouldSampleForTests: jest.fn(() => false),
    }));
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('feature_ingest_gmail_import', true, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a Gmail connect URL and completes callback token storage', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { getProviderConnection } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const user = { firstName: 'Gmail', lastName: 'Connect', email: 'gmail-connect@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');

    const connectRes = await request(app)
      .post('/api/ingestion/gmail/connect')
      .set({ Authorization: `Bearer ${token}` })
      .send({ redirectUri: 'http://localhost:8081/app' })
      .expect(200);

    const authUrl = new URL(connectRes.body.authUrl);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(authUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');

    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({
          access_token: 'gmail-access-token',
          refresh_token: 'gmail-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
        });
      }
      if (url.includes('/gmail/v1/users/me/profile')) {
        return jsonResponse({
          emailAddress: user.email,
          messagesTotal: 42,
          threadsTotal: 11,
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await request(app)
      .get('/api/ingestion/gmail/callback')
      .query({ code: 'gmail-auth-code', state })
      .expect(302);

    expect(fetchMock).toHaveBeenCalled();
    const connection = await getProviderConnection(userId, 'gmail');
    expect(connection).not.toBeNull();
    expect(connection?.accessToken).toBe('gmail-access-token');
    expect(connection?.refreshToken).toBe('gmail-refresh-token');
    expect(connection?.metadata.emailAddress).toBe(user.email);
  });

  it('returns Gmail status and dry-run results for a connected user', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { upsertProviderConnection } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const user = { firstName: 'Gmail', lastName: 'DryRun', email: 'gmail-dryrun@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    await upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'gmail-access-token',
      refreshToken: 'gmail-refresh-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { emailAddress: user.email },
    });

    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'msg-1', threadId: 'thread-1' }, { id: 'msg-2', threadId: 'thread-2' }] });
      }
      if (url.includes('/messages/msg-1?')) {
        return jsonResponse({
          id: 'msg-1',
          threadId: 'thread-1',
          internalDate: `${Date.now()}`,
          snippet: 'Flight confirmation to Rome',
          payload: {
            headers: [{ name: 'Subject', value: 'Flight Confirmation' }, { name: 'From', value: 'Delta Airlines <noreply@delta.com>' }],
          },
        });
      }
      if (url.includes('/messages/msg-2?')) {
        return jsonResponse({
          id: 'msg-2',
          threadId: 'thread-2',
          internalDate: `${Date.now()}`,
          snippet: 'Weekly grocery list',
          payload: {
            headers: [{ name: 'Subject', value: 'Groceries' }, { name: 'From', value: 'Store <noreply@example.com>' }],
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const statusRes = await request(app)
      .get('/api/ingestion/gmail/status')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.emailAddress).toBe(user.email);

    const dryRunRes = await request(app)
      .post('/api/ingestion/gmail/dry-run')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(200);

    expect(fetchMock).toHaveBeenCalled();
    expect(dryRunRes.body.messages).toHaveLength(1);
    expect(dryRunRes.body.messages[0].subject).toBe('Flight Confirmation');
  });

  it('imports Gmail messages into the shared review queue and preserves low-confidence undated items', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { upsertProviderConnection } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const user = { firstName: 'Gmail', lastName: 'Import', email: 'gmail-import@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'pro');
    await upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'gmail-access-token',
      refreshToken: 'gmail-refresh-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { emailAddress: user.email },
    });

    const futureDate = '2099-07-04 09:30';
    jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'msg-future', threadId: 'thread-1' }, { id: 'msg-undated', threadId: 'thread-2' }] });
      }
      if (url.includes('/messages/msg-future?')) {
        return jsonResponse({
          id: 'msg-future',
          threadId: 'thread-1',
          internalDate: `${Date.now()}`,
          snippet: 'Flight confirmation',
          payload: {
            headers: [{ name: 'Subject', value: 'Flight Confirmation' }, { name: 'From', value: 'Delta Airlines <noreply@delta.com>' }],
            parts: [
              {
                mimeType: 'text/plain',
                filename: '',
                body: {
                  data: Buffer.from(
                    `Subject: Flight confirmation\nTraveler: Bryan Duerk\nAirline: Delta Airlines\nFlight Number: DL123\nConfirmation Code: ABC123\nDeparture: ${futureDate}\nFrom: Boston\nTo: San Francisco`,
                    'utf8'
                  )
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, ''),
                },
              },
            ],
          },
        });
      }
      if (url.includes('/messages/msg-undated?')) {
        return jsonResponse({
          id: 'msg-undated',
          threadId: 'thread-2',
          internalDate: `${Date.now()}`,
          snippet: 'Itinerary note reservation',
          payload: {
            headers: [{ name: 'Subject', value: 'Travel Note' }, { name: 'From', value: 'Notes <noreply@example.com>' }],
            parts: [
              {
                mimeType: 'text/plain',
                filename: '',
                body: {
                  data: Buffer.from('Travel itinerary note\nReservation details pending\nProvider: Unknown', 'utf8')
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, ''),
                },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await request(app)
      .post('/api/ingestion/gmail/import')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(202);

    await helpers.waitFor(async () => {
      const review = await request(app).get('/api/ingestion/review-items').set({ Authorization: `Bearer ${token}` });
      return (review.body.items ?? []).length === 2;
    });

    const reviewRes = await request(app)
      .get('/api/ingestion/review-items')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(reviewRes.body.items).toHaveLength(2);
    expect(reviewRes.body.items.some((item: any) => item.status === 'LOW_CONFIDENCE')).toBe(true);
    expect(reviewRes.body.items.some((item: any) => item.itemType === 'flight')).toBe(true);
  });

  it('disconnects Gmail provider connections', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { upsertProviderConnection, getProviderConnection } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const user = { firstName: 'Gmail', lastName: 'Disconnect', email: 'gmail-disconnect@example.com', password: 'secret123' };
    const { token, userId } = await helpers.registerAndLoginWebUser(user);
    await helpers.setUserTierInDb(userId, 'premium');
    await upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'gmail-access-token',
      refreshToken: 'gmail-refresh-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: { emailAddress: user.email },
    });

    await request(app)
      .post('/api/ingestion/gmail/disconnect')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(200);

    const connection = await getProviderConnection(userId, 'gmail');
    expect(connection).toBeNull();
  });
});
