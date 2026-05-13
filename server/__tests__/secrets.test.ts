import {
  assertNoPubliclyExposedServerSecrets,
  findPubliclyExposedServerSecretEnvVars,
} from '../src/secrets';

describe('secret exposure guard', () => {
  const originalExpoPublicAuthSecret = process.env.EXPO_PUBLIC_AUTH_SECRET;

  afterEach(() => {
    if (originalExpoPublicAuthSecret === undefined) {
      delete process.env.EXPO_PUBLIC_AUTH_SECRET;
    } else {
      process.env.EXPO_PUBLIC_AUTH_SECRET = originalExpoPublicAuthSecret;
    }
  });

  it('detects backend secrets exposed via frontend-prefixed env vars', () => {
    process.env.EXPO_PUBLIC_AUTH_SECRET = 'leaked-secret';

    expect(findPubliclyExposedServerSecretEnvVars()).toContain('EXPO_PUBLIC_AUTH_SECRET');
    expect(() => assertNoPubliclyExposedServerSecrets()).toThrow(/EXPO_PUBLIC_AUTH_SECRET/);
  });
});
