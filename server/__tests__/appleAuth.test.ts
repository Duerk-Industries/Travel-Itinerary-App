/// <reference types="jest" />
/// <reference types="node" />
import { generateKeyPairSync } from 'crypto';

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
      emailVerified: true,
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
      emailVerified: true,
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
      emailVerified: true,
      firstName: 'Margaret',
      lastName: 'Hamilton',
    });

    // Apple omits `user` (name) on every login after the first.
    const second = await findOrCreateAppleUser({
      appleId: 'apple-sub-3',
      email: 'repeat@example.com',
      emailVerified: true,
    });

    expect(second.id).toBe(first.id);
  });

  it('throws when a brand-new Apple user has no email', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    await expect(findOrCreateAppleUser({ appleId: 'apple-sub-no-email', emailVerified: false })).rejects.toThrow(/email/i);
  });

  it('does not link an account when Apple marks the email as unverified', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    await expect(findOrCreateAppleUser({
      appleId: 'apple-sub-unverified',
      email: 'unverified@example.com',
      emailVerified: false,
    })).rejects.toThrow(/not verified/i);
  });
});

describe('appleAuth helpers', () => {
  afterEach(() => {
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    delete process.env.APPLE_CALLBACK_URL;
  });

  it('isAppleOAuthConfigured is false unless all required credentials and callback settings are set', () => {
    jest.resetModules();
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    delete process.env.APPLE_CALLBACK_URL;
    const { isAppleOAuthConfigured } = require('../src/appleAuth') as typeof import('../src/appleAuth');
    expect(isAppleOAuthConfigured()).toBe(false);

    process.env.APPLE_CLIENT_ID = 'com.example.app';
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    process.env.APPLE_KEY_ID = 'KEY1234567';
    process.env.APPLE_PRIVATE_KEY = 'not-a-real-key';
    expect(require('../src/appleAuth').isAppleOAuthConfigured()).toBe(false);
    process.env.APPLE_CALLBACK_URL = 'https://example.com/api/auth/apple/callback';
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

  it('creates state with a nonce and rejects tampered state', () => {
    jest.resetModules();
    const { createOAuthState, decodeOAuthState } = require('../src/auth') as typeof import('../src/auth');
    const state = createOAuthState({ redirectUri: 'travelitineraryplanner://login' });
    const decoded = decodeOAuthState(state);
    expect(decoded?.redirectUri).toBe('travelitineraryplanner://login');
    expect(decoded?.nonce).toEqual(expect.any(String));
    expect(decoded?.nonce.length).toBeGreaterThanOrEqual(16);
    expect(decodeOAuthState(`${state}tampered`)).toBeNull();
  });

  it('verifies Apple signatures and rejects a mismatched nonce', async () => {
    process.env.APPLE_CLIENT_ID = 'com.example.app';
    jest.resetModules();
    const axiosModule = require('axios');
    const axios = axiosModule.default ?? axiosModule;
    const jwt = require('jsonwebtoken');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'apple-test-key', use: 'sig', alg: 'RS256' };
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { keys: [jwk] } });
    const token = jwt.sign(
      { sub: 'apple-sub', email: 'apple@example.com', email_verified: true, nonce: 'expected-nonce' },
      privateKey,
      { algorithm: 'RS256', issuer: 'https://appleid.apple.com', audience: 'com.example.app', header: { kid: 'apple-test-key' } }
    );
    const { verifyAppleIdToken } = require('../src/appleAuth') as typeof import('../src/appleAuth');
    await expect(verifyAppleIdToken(token, 'expected-nonce')).resolves.toMatchObject({ sub: 'apple-sub' });
    await expect(verifyAppleIdToken(token, 'wrong-nonce')).rejects.toThrow(/nonce/i);
  });
});
