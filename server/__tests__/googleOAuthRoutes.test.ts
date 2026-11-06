import request from 'supertest';
import passport from 'passport';
import { app } from '../src/app';
import { createOAuthState } from '../src/auth';
import { closePool, findOrCreateGoogleUser, initDb } from '../src/db';

describe('Google OAuth callback destinations', () => {
  let user: Awaited<ReturnType<typeof findOrCreateGoogleUser>>;
  let authenticate: jest.SpyInstance;

  beforeAll(async () => {
    await initDb();
    user = await findOrCreateGoogleUser({
      id: 'google-native-redirect-test',
      emails: [{ value: 'google-native-redirect@example.com' }],
      name: { givenName: 'Google', familyName: 'Traveler' },
      photos: [],
    });
  });

  beforeEach(() => {
    authenticate = jest.spyOn(passport, 'authenticate').mockImplementation(((_strategy: unknown, _options: unknown, callback: Function) =>
      (_req: unknown, _res: unknown, _next: unknown) => callback(null, user)) as typeof passport.authenticate);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await closePool(); });

  it('returns to the native app with a single-use exchange code', async () => {
    const response = await request(app).get('/api/auth/google/callback').query({
      state: createOAuthState({ redirectUri: 'travelitineraryplanner://login' }),
    }).expect(302);
    const destination = new URL(response.headers.location);
    expect(destination.protocol).toBe('travelitineraryplanner:');
    expect(destination.hostname).toBe('login');
    expect(destination.searchParams.has('token')).toBe(false);
    const code = destination.searchParams.get('auth_code');
    expect(code).toBeTruthy();
    await request(app).post('/api/auth/exchange').send({ code }).expect(200);
    await request(app).post('/api/auth/exchange').send({ code }).expect(400);
  });

  it('preserves an allowed web return destination', async () => {
    const { getBackendUrl } = await import('../src/env');
    const webUrl = getBackendUrl('https://wander-bunnies.com') || 'https://wander-bunnies.com';
    const redirectUri = new URL('/login', webUrl).toString();
    const response = await request(app).get('/api/auth/google/callback').query({
      state: createOAuthState({ redirectUri }),
    }).expect(302);
    expect(new URL(response.headers.location).origin).toBe(new URL(redirectUri).origin);
    expect(new URL(response.headers.location).searchParams.has('auth_code')).toBe(true);
  });

  it('retains the web fallback for callbacks without state', async () => {
    const response = await request(app).get('/api/auth/google/callback').expect(302);
    expect(response.headers.location).toMatch(/^\/login\?auth_code=/);
  });

  it('does not redirect to a destination outside the allowlist', async () => {
    const response = await request(app).get('/api/auth/google/callback').query({
      state: createOAuthState({ redirectUri: 'https://attacker.example/login' }),
    }).expect(302);
    expect(response.headers.location).toMatch(/^\/login\?auth_code=/);
  });

  it('rejects tampered state before authenticating', async () => {
    const response = await request(app).get('/api/auth/google/callback').query({ state: 'invalid' }).expect(302);
    expect(response.headers.location).toContain('auth_error=google_callback_failed');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns authentication failures to the app', async () => {
    authenticate.mockImplementation(((_strategy: unknown, _options: unknown, callback: Function) =>
      () => callback(new Error('denied'), null)) as typeof passport.authenticate);
    const response = await request(app).get('/api/auth/google/callback').query({
      state: createOAuthState({ redirectUri: 'travelitineraryplanner://login' }),
    }).expect(302);
    expect(response.headers.location).toBe('travelitineraryplanner://login?auth_error=google_login_failed');
  });
});
