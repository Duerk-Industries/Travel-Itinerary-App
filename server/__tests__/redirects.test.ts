import { appendTokenToRedirect, resolveAndValidateRedirectUri } from '../src/redirects';

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

describe('appendTokenToRedirect', () => {
  it('stores tokens in the URL hash for web redirects', () => {
    const next = appendTokenToRedirect('https://duerk.org/login?foo=bar', 'abc123');
    expect(next).toBe('https://duerk.org/login?foo=bar#token=abc123');
  });

  it('preserves native-scheme redirects with query tokens', () => {
    const next = appendTokenToRedirect('travel-itinerary://login', 'abc123');
    expect(next).toBe('travel-itinerary://login?token=abc123');
  });
});
