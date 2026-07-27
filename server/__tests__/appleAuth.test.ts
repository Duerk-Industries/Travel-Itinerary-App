/// <reference types="jest" />
/// <reference types="node" />

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('findOrCreateAppleUser', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
  });

  it('creates a new user on first sign-in and captures the first-login-only name', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    const user = await findOrCreateAppleUser({
      appleId: 'apple-sub-1',
      email: 'newapple@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(user.email).toBe('newapple@example.com');
    expect(user.provider).toBe('apple');
  });

  it('links an existing email-provider account by verified email, preserving the account id', async () => {
    const { findOrCreateUser, findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    const existing = await findOrCreateUser('shared@example.com', 'email');

    const linked = await findOrCreateAppleUser({
      appleId: 'apple-sub-2',
      email: 'shared@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
    });

    expect(linked.id).toBe(existing.id);
  });

  it('finds the same user by apple_id on a subsequent login without a name payload', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    const first = await findOrCreateAppleUser({
      appleId: 'apple-sub-3',
      email: 'repeat@example.com',
      firstName: 'Margaret',
      lastName: 'Hamilton',
    });

    // Apple omits `user` (name) on every login after the first.
    const second = await findOrCreateAppleUser({
      appleId: 'apple-sub-3',
      email: 'repeat@example.com',
    });

    expect(second.id).toBe(first.id);
  });

  it('throws when a brand-new Apple user has no email', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    await expect(findOrCreateAppleUser({ appleId: 'apple-sub-no-email' })).rejects.toThrow(/email/i);
  });
});

describe('appleAuth helpers', () => {
  afterEach(() => {
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
  });

  it('isAppleOAuthConfigured is false unless all four env vars are set', () => {
    jest.resetModules();
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    const { isAppleOAuthConfigured } = require('../src/appleAuth') as typeof import('../src/appleAuth');
    expect(isAppleOAuthConfigured()).toBe(false);

    process.env.APPLE_CLIENT_ID = 'com.example.app';
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    process.env.APPLE_KEY_ID = 'KEY1234567';
    process.env.APPLE_PRIVATE_KEY = 'not-a-real-key';
    jest.resetModules();
    const reloaded = require('../src/appleAuth') as typeof import('../src/appleAuth');
    expect(reloaded.isAppleOAuthConfigured()).toBe(true);
  });

  it('parseAppleUserPayload extracts first/last name from the first-login JSON payload', () => {
    const { parseAppleUserPayload } = require('../src/appleAuth') as typeof import('../src/appleAuth');
    const parsed = parseAppleUserPayload(
      JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' }, email: 'ada@example.com' })
    );
    expect(parsed).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('parseAppleUserPayload returns an empty object for undefined or malformed input', () => {
    const { parseAppleUserPayload } = require('../src/appleAuth') as typeof import('../src/appleAuth');
    expect(parseAppleUserPayload(undefined)).toEqual({});
    expect(parseAppleUserPayload('not json')).toEqual({});
  });
});
