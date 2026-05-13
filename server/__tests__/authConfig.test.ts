import {
  assertSafeAuthSecretConfig,
  DEFAULT_AUTH_SECRET,
  isUnsafeAuthSecret,
} from '../src/authConfig';

describe('authConfig', () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalKService = process.env.K_SERVICE;
  const originalE2eMode = process.env.E2E_MODE;

  afterEach(() => {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
    if (originalKService === undefined) {
      delete process.env.K_SERVICE;
    } else {
      process.env.K_SERVICE = originalKService;
    }
    if (originalE2eMode === undefined) {
      delete process.env.E2E_MODE;
    } else {
      process.env.E2E_MODE = originalE2eMode;
    }
  });

  it('treats missing or default auth secrets as unsafe', () => {
    expect(isUnsafeAuthSecret(undefined)).toBe(true);
    expect(isUnsafeAuthSecret('')).toBe(true);
    expect(isUnsafeAuthSecret(` ${DEFAULT_AUTH_SECRET} `)).toBe(true);
    expect(isUnsafeAuthSecret('real-secret')).toBe(false);
  });

  it('throws outside local development when AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET;
    process.env.K_SERVICE = 'travel-itinerary-app';
    expect(() => assertSafeAuthSecretConfig()).toThrow(
      'AUTH_SECRET must be set to a non-default value outside local development.'
    );
  });

  it('throws outside local development when AUTH_SECRET uses the default value', () => {
    process.env.AUTH_SECRET = 'development-secret';
    process.env.K_SERVICE = 'travel-itinerary-app';
    expect(() => assertSafeAuthSecretConfig()).toThrow(
      'AUTH_SECRET must be set to a non-default value outside local development.'
    );
  });

  it('allows the default secret in local development', () => {
    process.env.AUTH_SECRET = 'development-secret';
    delete process.env.K_SERVICE;
    process.env.E2E_MODE = '1';
    expect(() => assertSafeAuthSecretConfig()).not.toThrow();
  });
});
