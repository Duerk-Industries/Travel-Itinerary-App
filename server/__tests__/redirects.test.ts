import { resolveAndValidateRedirectUri } from '../src/redirects';

describe('resolveAndValidateRedirectUri', () => {
  const originalAllowlist = process.env.AUTH_REDIRECT_URI_ALLOWLIST;

  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.AUTH_REDIRECT_URI_ALLOWLIST;
    } else {
      process.env.AUTH_REDIRECT_URI_ALLOWLIST = originalAllowlist;
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
});
