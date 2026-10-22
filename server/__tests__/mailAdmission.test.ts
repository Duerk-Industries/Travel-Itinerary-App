import { randomUUID } from 'crypto';

describe('mail admission safety and recovery (Postgres repository via pg-mem)', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.DB_PROVIDER = 'memory'; process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = 'pg-mem://localhost/mail-admission';
    process.env.INGESTION_VIRUS_SCAN_PROVIDER = 'stub';
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
  });
  const setup = async () => {
    const helpers = require('./helpers') as typeof import('./helpers');
    const { userId } = await helpers.registerAndLoginWebUser({ firstName: 'Mail', lastName: 'Owner', email: `${randomUUID()}@example.com`, password: 'secret123' });
    const repo = require('../src/ingestion/shared/mailAdmission') as typeof import('../src/ingestion/shared/mailAdmission');
    const address = await repo.getMailAlias(userId);
    const alias = (await repo.resolveMailAlias(address))!;
    return { userId, repo, address, alias };
  };

  it('uses a secret recipient capability and immediately revokes it on rotation', async () => {
    const { userId, repo, address } = await setup();
    expect(address).toMatch(/^u-[a-z2-7]{26}@in\.wander-bunnies\.com$/);
    expect(await repo.getMailAlias(userId)).toBe(address);
    expect(await repo.resolveMailAlias('travel.docs@wander-bunnies.com')).toBeNull();
    const next = await repo.getMailAlias(userId, true);
    expect(next).not.toBe(address);
    expect(await repo.resolveMailAlias(address)).toBeNull();
    expect((await repo.resolveMailAlias(next))?.userId).toBe(userId);
  });

  it('records delivery and quota once and retains recoverable encrypted bytes on retry', async () => {
    const { userId, repo, alias } = await setup();
    const params = { id: 'receipt', ...alias, raw: { body: { subject: 'private booking', 'body-plain': 'confirmation' }, files: [] }, monthlyLimit: 10, allowLargeLlm: false, allowSmallLlm: false };
    const first = await repo.admitMail(params);
    const replay = await repo.admitMail(params);
    expect(replay).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('private booking');
    expect(repo.readRawMail(first!).body.subject).toBe('private booking');
    const db = require('../src/db') as typeof import('../src/db');
    const { INGESTION_USAGE_KEYS } = require('../src/ingestion/config') as typeof import('../src/ingestion/config');
    expect(await db.getUsageCounter(userId, INGESTION_USAGE_KEYS.forwardedMailboxDeliveries, new Date().toISOString().slice(0, 7))).toBe(1);
  });

  it('holds without scanning/spend, protects release ownership, and charges once on Import once', async () => {
    const { userId, repo, alias } = await setup();
    const held = await repo.admitMail({ id: 'held', ...alias, raw: { body: { text: 'review me' }, files: [] }, monthlyLimit: 0, allowLargeLlm: false, allowSmallLlm: false });
    expect(held?.state).toBe('HELD');
    expect(await repo.releaseHeldMail('held', randomUUID(), 10)).toBe(false);
    expect(await repo.releaseHeldMail('held', userId, 10)).toBe(true);
    expect(await repo.releaseHeldMail('held', userId, 10)).toBe(false);
    expect((await repo.listMailReceipts(userId))[0].quotaReserved).toBe(true);
  });

  it('fences receipt leases so an old worker cannot complete a newer attempt', async () => {
    const { repo, alias } = await setup();
    await repo.admitMail({ id: 'leased', ...alias, raw: { body: { text: 'booking' }, files: [] }, monthlyLimit: 10, allowLargeLlm: false, allowSmallLlm: false });
    await repo.updateMailReceipt('leased', r => ({ ...r, lease: 'new-worker' }));
    expect(await repo.updateMailReceipt('leased', r => r.lease === 'old-worker' ? { ...r, state: 'COMPLETE' } : null)).toBeNull();
    expect((await repo.listMailReceipts(alias.userId))[0].state).toBe('PENDING');
  });
});
