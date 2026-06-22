import {
  appendAuthCodeToRedirect,
  consumeRedirectTokenExchangeCode,
  createRedirectTokenExchangeCode,
  resolveAndValidateRedirectUri,
} from '../src/redirects';

describe('resolveAndValidateRedirectUri', () => {
  const originalAllowlist = process.env.AUTH_REDIRECT_URI_ALLOWLIST;
  const originalKService = process.env.K_SERVICE;

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

  it('accepts the production app login redirect without extra deployment configuration', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'https://duerk.org';
    const result = resolveAndValidateRedirectUri('travelitineraryplanner://login', 'https://duerk.org');
    expect(result.error).toBeUndefined();
    expect(result.redirectUri).toBe('travelitineraryplanner://login');
  });

  it('does not allow a different native route that merely shares the login prefix', () => {
    process.env.AUTH_REDIRECT_URI_ALLOWLIST = 'travelitineraryplanner://login';
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
