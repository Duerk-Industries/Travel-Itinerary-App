describe('secret exposure guard', () => {
  const originalExpoPublicAuthSecret = process.env.EXPO_PUBLIC_AUTH_SECRET;

  afterEach(() => {
    jest.resetModules();
    if (originalExpoPublicAuthSecret === undefined) {
      delete process.env.EXPO_PUBLIC_AUTH_SECRET;
    } else {
      process.env.EXPO_PUBLIC_AUTH_SECRET = originalExpoPublicAuthSecret;
    }
  });

  it('detects backend secrets exposed via frontend-prefixed env vars', async () => {
    process.env.EXPO_PUBLIC_AUTH_SECRET = 'leaked-secret';
    const { findPubliclyExposedServerSecretEnvVars, assertNoPubliclyExposedServerSecrets } = await import('../src/secrets');

    expect(findPubliclyExposedServerSecretEnvVars()).toContain('EXPO_PUBLIC_AUTH_SECRET');
    expect(() => assertNoPubliclyExposedServerSecrets()).toThrow(/EXPO_PUBLIC_AUTH_SECRET/);
  });
});
