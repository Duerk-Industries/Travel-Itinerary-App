import { randomUUID } from 'crypto';

describe('additional forwarding address verification (pg-mem)', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.DB_PROVIDER = 'memory'; process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = 'pg-mem://localhost/verified-senders';
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
  });
  const setup = async () => {
    const helpers = require('./helpers') as typeof import('./helpers');
    const { userId } = await helpers.registerAndLoginWebUser({ firstName: 'Verify', lastName: 'Owner', email: `${randomUUID()}@example.com`, password: 'secret123' });
    const repo = require('../src/ingestion/shared/verifiedSenders') as typeof import('../src/ingestion/shared/verifiedSenders');
    return { userId, repo };
  };
  const start = async (repo: any, userId: string, email: string) => {
    const started = await repo.startSenderVerification(userId, email);
    if (started.alreadyVerified) throw new Error('unexpected');
    return started.code as string;
  };

  it('verifies with a single-use code and normalizes the address', async () => {
    const { userId, repo } = await setup();
    const code = await start(repo, userId, ' Me@Example.COM ');
    expect(await repo.isVerifiedSender(userId, 'me@example.com')).toBe(false);
    const address = await repo.confirmSenderVerification(userId, 'me@example.com', code);
    expect(address.status).toBe('VERIFIED');
    expect(await repo.isVerifiedSender(userId, 'ME@example.com')).toBe(true);
    await expect(repo.confirmSenderVerification(userId, 'me@example.com', code)).rejects.toMatchObject({ code: 'verification_invalid' });
    expect(await repo.startSenderVerification(userId, 'me@example.com')).toEqual({ alreadyVerified: true });
  });

  it('never exposes the code or hash in listings and rejects another account', async () => {
    const { userId, repo } = await setup();
    const other = await setup();
    const code = await start(repo, userId, 'a@example.com');
    expect(JSON.stringify(await repo.listSenders(userId))).not.toContain(code);
    await expect(repo.confirmSenderVerification(other.userId, 'a@example.com', code)).rejects.toMatchObject({ code: 'verification_invalid' });
    expect(await repo.isVerifiedSender(other.userId, 'a@example.com')).toBe(false);
  });

  it('invalidates the code after too many wrong guesses and after expiry', async () => {
    const { userId, repo } = await setup();
    const code = await start(repo, userId, 'b@example.com');
    for (let i = 0; i < repo.VERIFIED_SENDER_MAX_ATTEMPTS; i += 1) {
      await expect(repo.confirmSenderVerification(userId, 'b@example.com', 'zzzzzzzz')).rejects.toMatchObject({ code: 'verification_invalid' });
    }
    await expect(repo.confirmSenderVerification(userId, 'b@example.com', code)).rejects.toMatchObject({ code: 'verification_invalid' });

    const expiring = await start(repo, userId, 'c@example.com');
    const real = Date.now;
    Date.now = () => real() + repo.VERIFIED_SENDER_CODE_TTL_MS + 1;
    try {
      await expect(repo.confirmSenderVerification(userId, 'c@example.com', expiring)).rejects.toMatchObject({ code: 'verification_invalid' });
    } finally { Date.now = real; }
  });

  it('rate-limits resends, caps addresses, supports removal and rejects bad email', async () => {
    const { userId, repo } = await setup();
    await expect(repo.startSenderVerification(userId, 'not-an-email')).rejects.toMatchObject({ code: 'invalid_email' });
    await start(repo, userId, 'd@example.com');
    await expect(repo.startSenderVerification(userId, 'd@example.com')).rejects.toMatchObject({ code: 'verification_too_soon' });
    for (let i = 1; i < repo.VERIFIED_SENDER_MAX_PER_USER; i += 1) await start(repo, userId, `x${i}@example.com`);
    await expect(repo.startSenderVerification(userId, 'extra@example.com')).rejects.toMatchObject({ code: 'too_many_addresses' });
    const [first] = await repo.listSenders(userId);
    expect(await repo.removeSender(randomUUID(), first.id)).toBe(false);
    expect(await repo.removeSender(userId, first.id)).toBe(true);
    expect(await repo.listSenders(userId)).toHaveLength(repo.VERIFIED_SENDER_MAX_PER_USER - 1);
  });
});
