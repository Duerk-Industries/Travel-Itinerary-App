/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

describe('Apple OAuth routes', () => {
  const originalFlagsPath = process.env.AUTH_FLAGS_CONFIG_PATH;
  const originalAppleValues = {
    clientId: process.env.APPLE_CLIENT_ID,
    teamId: process.env.APPLE_TEAM_ID,
    keyId: process.env.APPLE_KEY_ID,
    privateKey: process.env.APPLE_PRIVATE_KEY,
    callbackUrl: process.env.APPLE_CALLBACK_URL,
  };
  let tempDir = '';
  let app: typeof import('../src/app').app;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-oauth-routes-'));
    const flagsPath = path.join(tempDir, 'auth-flags.yaml');
    fs.writeFileSync(flagsPath, 'flags:\n  appleOAuthEnabled: true\n', 'utf8');
    process.env.AUTH_FLAGS_CONFIG_PATH = flagsPath;
    process.env.APPLE_CLIENT_ID = 'com.example.travel.apple';
    process.env.APPLE_TEAM_ID = 'TEAM123456';
    process.env.APPLE_KEY_ID = 'KEY1234567';
    process.env.APPLE_PRIVATE_KEY = 'not-used-by-route-tests';
    process.env.APPLE_CALLBACK_URL = 'https://example.com/api/auth/apple/callback';
    jest.resetModules();
    app = require('../src/app').app;
  });

  afterAll(() => {
    if (originalFlagsPath === undefined) delete process.env.AUTH_FLAGS_CONFIG_PATH;
    else process.env.AUTH_FLAGS_CONFIG_PATH = originalFlagsPath;
    for (const [key, value] of Object.entries({
      APPLE_CLIENT_ID: originalAppleValues.clientId,
      APPLE_TEAM_ID: originalAppleValues.teamId,
      APPLE_KEY_ID: originalAppleValues.keyId,
      APPLE_PRIVATE_KEY: originalAppleValues.privateKey,
      APPLE_CALLBACK_URL: originalAppleValues.callbackUrl,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('includes the signed state nonce in the Apple authorization request', async () => {
    const response = await request(app)
      .get('/api/auth/apple')
      .query({ redirect_uri: 'travelitineraryplanner://login' })
      .expect(302);

    const location = new URL(String(response.headers.location));
    expect(location.origin).toBe('https://appleid.apple.com');
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(response.headers['set-cookie']?.some((cookie: string) => cookie.startsWith('apple_oauth_nonce='))).toBe(true);
    const { decodeOAuthState } = require('../src/auth') as typeof import('../src/auth');
    const state = decodeOAuthState(String(location.searchParams.get('state')));
    expect(state?.redirectUri).toBe('travelitineraryplanner://login');
    expect(state?.nonce).toBe(location.searchParams.get('nonce'));
  });

  it('rejects an invalid redirect URI before contacting Apple', async () => {
    await request(app)
      .get('/api/auth/apple')
      .query({ redirect_uri: 'https://attacker.example/callback' })
      .expect(400);
  });

  it('rejects a callback without valid state', async () => {
    const response = await request(app)
      .post('/api/auth/apple/callback')
      .type('form')
      .send({ code: 'authorization-code-without-state' })
      .expect(302);

    expect(String(response.headers.location)).toContain('/login?auth_error=apple_callback_failed');
  });

  it('rejects a valid state when the browser nonce cookie is absent', async () => {
    const authorization = await request(app)
      .get('/api/auth/apple')
      .query({ redirect_uri: 'travelitineraryplanner://login' })
      .expect(302);
    const location = new URL(String(authorization.headers.location));
    await request(app)
      .post('/api/auth/apple/callback')
      .type('form')
      .send({ code: 'authorization-code-without-cookie', state: location.searchParams.get('state') })
      .expect(302);
  });

  it('uses state from Apple form_post errors to preserve the native redirect', async () => {
    const authorization = await request(app)
      .get('/api/auth/apple')
      .query({ redirect_uri: 'travelitineraryplanner://login' })
      .expect(302);
    const location = new URL(String(authorization.headers.location));
    const cookie = authorization.headers['set-cookie']?.[0];

    const response = await request(app)
      .post('/api/auth/apple/callback')
      .set('Cookie', cookie ?? '')
      .type('form')
      .send({ error: 'access_denied', state: location.searchParams.get('state') })
      .expect(302);

    expect(String(response.headers.location)).toContain('travelitineraryplanner://login');
    expect(String(response.headers.location)).toContain('auth_error=apple_callback_failed');
  });
});
