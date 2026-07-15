/// <reference types="jest" />
/// <reference types="node" />
import {
  appendAuthCodeToRedirect,
  consumeRedirectTokenExchangeCode,
  createRedirectTokenExchangeCode,
  resolveAndValidateRedirectUri,
} from '../src/redirects';

describe('resolveAndValidateRedirectUri', () => {
  const originalAllowlist = process.env.AUTH_REDIRECT_URI_ALLOWLIST;
  const originalKService = process.env.K_SERVICE;
  const originalRunLocal = process.env.RUN_LOCAL;

  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.AUTH_REDIRECT_URI_ALLOWLIST;
    } else {
      process.env.AUTH_REDIRECT_URI_ALLOWLIST = originalAllowlist;
    }
    if (originalKService === undefined) {
      delete process.env.K_SERVICE;
    } else {
      process.env.K_SERVICE = originalKService;
    }
    if (originalRunLocal === undefined) {
      delete process.env.RUN_LOCAL;
    } else {
      process.env.RUN_LOCAL = originalRunLocal;
    }
  });

  it('accepts a web origin redirect when allow-listed', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org,https://staging.duerk.org';
    const result = resolveAndValidateRedirectUri('https://duerk.org/login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('https://duerk.org/login');
  });

  it('accepts the www companion of the configured web URL', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = '';
    const result = resolveAndValidateRedirectUri('https://www.duerk.org/login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('https://www.duerk.org/login');
  });

  it('rejects a web redirect when origin is not allow-listed', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://staging.duerk.org';
    const result = resolveAndValidateRedirectUri('https://duerk.org/login', 'https://example.com');
    expect(result.redirectUri).toBeUndefined();
    expect(result.error).toBe('redirect_uri is not allowed.');
  });

  it('accepts a native scheme redirect when allow-listed by prefix', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'travel-itinerary://,exp://127.0.0.1:19000/--/';
    const result = resolveAndValidateRedirectUri('travel-itinerary://login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('travel-itinerary://login');
  });

  // Regression: the native app's deep-link scheme is `travelitineraryplanner` (app/app.config.ts).
  // Production once rejected native Google sign-in with HTTP 400 because ops forgot to add the
  // scheme to AUTH_REDIRECT_URI_ALLOWLIST (works on web, fails in the app) — so it's now always
  // allowed via DEFAULT_NATIVE_AUTH_REDIRECT_URIS, independent of env config. That's safe because
  // the scheme isn't attacker-controlled: only the installed app can register it with the OS.
  it('accepts the production native app scheme even without explicit deployment configuration', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org;http://localhost:8081';
    const result = resolveAndValidateRedirectUri('travelitineraryplanner://login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('travelitineraryplanner://login');
  });

  it('does not let a different native route piggyback on the default scheme via a shared prefix', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org;http://localhost:8081';
    const result = resolveAndValidateRedirectUri('travelitineraryplanner://login-evil', 'https://duerk.org');
    expect(result.redirectUri).toBeUndefined();
    expect(result.error).toBe('redirect_uri is not allowed.');
  });

  it('allows relative redirects resolved against webUrl', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org';
    const result = resolveAndValidateRedirectUri('/login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('https://duerk.org/login');
  });

  it('rejects localhost web redirects in production even when allow-listed', () => {
    process.env.K_SERVICE = 'travel-itinerary-app';
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org,http://localhost:4000';
    const result = resolveAndValidateRedirectUri('http://localhost:4000/login', 'https://duerk.org');
    expect(result.redirectUri).toBeUndefined();
    expect(result.error).toBe('redirect_uri is not allowed.');
  });

  it('still allows localhost web redirects in local development', () => {
    delete process.env.K_SERVICE;
    process.env.RUN_LOCAL = '1';
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'http://localhost:4000';
    const result = resolveAndValidateRedirectUri('http://localhost:4000/login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('http://localhost:4000/login');
  });
});

describe('redirect auth exchange', () => {
  it('stores a short-lived auth code in the redirect URL instead of a token', () => {
    const next = appendAuthCodeToRedirect('https://duerk.org/login?foo=bar', 'abc123');
    expect(next).toBe('https://duerk.org/login?foo=bar&auth_code=abc123');
  });

  it('supports one-time auth code exchange', () => {
    const code = createRedirectTokenExchangeCode({
      token: 'signed-jwt',
      requirePasswordSetup: true,
    });

    expect(consumeRedirectTokenExchangeCode(code)).toEqual({
      token: 'signed-jwt',
      requirePasswordSetup: true,
    });
    expect(consumeRedirectTokenExchangeCode(code)).toBeNull();
  });
});
