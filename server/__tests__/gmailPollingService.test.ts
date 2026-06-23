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

describe('gmail polling service', () => {
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

  const seedGmailConnection = async (
    repo: typeof import('../src/ingestion/shared/repository'),
    userId: string,
    overrides: {
      lastPolledAt?: string;
      status?: string;
      refreshToken?: string | null;
      tokenExpiry?: string | null;
    } = {},
  ) => {
    await repo.upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: 'polling-access-token',
      refreshToken: overrides.refreshToken ?? 'polling-refresh-token',
      tokenExpiry: overrides.tokenExpiry ?? new Date(Date.now() + 3600_000).toISOString(),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      metadata: overrides.lastPolledAt ? { lastPolledAt: overrides.lastPolledAt } : {},
    });
    if (overrides.status && overrides.status !== 'connected') {
      await repo.updateProviderConnectionStatus({
        userId,
        provider: 'gmail',
        status: overrides.status,
      });
    }
    const connection = await repo.getProviderConnection(userId, 'gmail');
    if (!connection) throw new Error('expected a seeded gmail connection');
    return connection;
  };

  const registerUserWithTier = async (
    emailPrefix: string,
    tierKey: string,
  ): Promise<{ userId: string }> => {
    const helpers = require('./helpers') as typeof import('./helpers');
    const { userId } = await helpers.registerAndLoginWebUser({
      firstName: 'Polling',
      lastName: 'User',
      email: `${emailPrefix}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'secret123',
    });
    if (tierKey !== 'free') {
      await helpers.setUserTierInDb(userId, tierKey);
    }
    return { userId };
  };

  it('selects a Pro connection that has never been polled and enqueues its payloads', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('pro-new', 'pro');
    const connection = await seedGmailConnection(repo, userId);

    const buildMock = jest
      .spyOn(gmailIntake, 'buildGmailIngestionPayloads')
      .mockResolvedValue([{ id: 'p1' } as any, { id: 'p2' } as any]);
    const enqueueMock = jest
      .spyOn(orchestrator, 'enqueueIngestionPipelineJob')
      .mockResolvedValue({ id: 'job' } as any);

    const results = await polling.runGmailPollingTick({ now: new Date() });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        connectionId: connection.id,
        userId,
        tierKey: 'pro',
        skipped: false,
        payloadsEnqueued: 2,
      }),
    );
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(buildMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ userId, lookbackDays: 90 }),
    );
    expect(enqueueMock).toHaveBeenCalledTimes(2);

    const after = await repo.getProviderConnection(userId, 'gmail');
    expect(typeof after?.metadata?.lastPolledAt).toBe('string');
  });

  it('skips a Pro connection polled less than 4 hours ago but picks it up after the cadence elapses', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('pro-recent', 'pro');
    const now = new Date('2026-04-23T12:00:00Z');
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    await seedGmailConnection(repo, userId, { lastPolledAt: twoHoursAgo });

    const buildMock = jest
      .spyOn(gmailIntake, 'buildGmailIngestionPayloads')
      .mockResolvedValue([]);
    jest.spyOn(orchestrator, 'enqueueIngestionPipelineJob').mockResolvedValue({ id: 'job' } as any);

    const tooEarly = await polling.runGmailPollingTick({ now });
    expect(tooEarly[0]).toEqual(expect.objectContaining({ skipped: true, reason: 'not_due' }));
    expect(buildMock).not.toHaveBeenCalled();

    const fiveHoursLater = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const dueNow = await polling.runGmailPollingTick({ now: fiveHoursLater });
    expect(dueNow[0]).toEqual(expect.objectContaining({ skipped: false, payloadsEnqueued: 0 }));
    expect(buildMock).toHaveBeenCalledTimes(1);
  });

  it('uses a 24h cadence for Premium tier', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('premium', 'premium');
    const now = new Date('2026-04-23T12:00:00Z');
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    await seedGmailConnection(repo, userId, { lastPolledAt: twelveHoursAgo });

    const buildMock = jest
      .spyOn(gmailIntake, 'buildGmailIngestionPayloads')
      .mockResolvedValue([]);
    jest.spyOn(orchestrator, 'enqueueIngestionPipelineJob').mockResolvedValue({ id: 'job' } as any);

    const tooEarly = await polling.runGmailPollingTick({ now });
    expect(tooEarly[0]).toEqual(expect.objectContaining({ skipped: true, reason: 'not_due', tierKey: 'premium' }));

    const aDayLater = new Date(now.getTime() + 13 * 60 * 60 * 1000);
    const due = await polling.runGmailPollingTick({ now: aDayLater });
    expect(due[0]).toEqual(expect.objectContaining({ skipped: false, tierKey: 'premium' }));
    expect(buildMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ lookbackDays: 30 }));
  });

  it('skips connections on the free tier regardless of cadence', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const orchestrator = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('free-user', 'free');
    await seedGmailConnection(repo, userId);

    const buildMock = jest.spyOn(gmailIntake, 'buildGmailIngestionPayloads').mockResolvedValue([]);
    const enqueueMock = jest.spyOn(orchestrator, 'enqueueIngestionPipelineJob').mockResolvedValue({ id: 'job' } as any);

    const results = await polling.runGmailPollingTick({ now: new Date() });
    expect(results[0]).toEqual(expect.objectContaining({ skipped: true, reason: 'tier_not_eligible', tierKey: 'free' }));
    expect(buildMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('skips connections with AUTH_EXPIRED status without calling the Gmail API', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('pro-expired', 'pro');
    await seedGmailConnection(repo, userId, { status: 'AUTH_EXPIRED' });

    const buildMock = jest.spyOn(gmailIntake, 'buildGmailIngestionPayloads').mockResolvedValue([]);

    const results = await polling.runGmailPollingTick({ now: new Date() });
    expect(results[0]).toEqual(expect.objectContaining({ skipped: true, reason: 'auth_expired' }));
    expect(buildMock).not.toHaveBeenCalled();
  });

  it('records lastPollError on the connection metadata when payload build throws', async () => {
    const polling = require('../src/services/gmailPollingService') as typeof import('../src/services/gmailPollingService');
    const gmailIntake = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const repo = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const { userId } = await registerUserWithTier('pro-failing', 'pro');
    await seedGmailConnection(repo, userId);

    jest
      .spyOn(gmailIntake, 'buildGmailIngestionPayloads')
      .mockRejectedValue(new Error('simulated gmail api failure'));

    const results = await polling.runGmailPollingTick({ now: new Date() });
    expect(results[0]).toEqual(
      expect.objectContaining({
        skipped: false,
        error: expect.stringContaining('simulated gmail api failure'),
      }),
    );

    const after = await repo.getProviderConnection(userId, 'gmail');
    expect(after?.metadata?.lastPollError).toMatch(/simulated gmail api failure/);
    // lastPolledAt is still advanced so a failing connection does not busy-loop.
    expect(typeof after?.metadata?.lastPolledAt).toBe('string');
  });
});
