/// <reference types="jest" />

const validators = require('../../../scripts/lib/phase11-validators');

describe('Phase 11 release manifest validation', () => {
  const manifest = {
    gitSha: '1234567890abcdef1234567890abcdef12345678',
    backendImageDigest: 'us-east5-docker.pkg.dev/project/repo/backend:1234567@sha256:abcdef',
    frontendArtifact: 'dist/release/frontend.tgz',
    frontendSha256: 'a'.repeat(64),
    firestoreIndexesSha256: 'b'.repeat(64),
    configFingerprint: 'c'.repeat(64),
    builtAt: '2026-07-07T00:00:00.000Z',
    builderRunId: '123',
  };

  it('accepts a digest-pinned immutable manifest', () => {
    expect(() => validators.validateReleaseManifest(manifest)).not.toThrow();
  });

  it('rejects manifests that are not backend digest pinned', () => {
    expect(() => validators.validateReleaseManifest({ ...manifest, backendImageDigest: 'repo/backend:latest' }))
      .toThrow(/digest-pinned/);
  });

  it('computes config fingerprints without secret-like keys', () => {
    const fingerprintA = validators.configFingerprint({
      PROD_SERVICE_NAME: 'prod',
      PROD_SECRET_KEY: 'one',
      TEST_SERVICE_NAME: 'test',
    });
    const fingerprintB = validators.configFingerprint({
      PROD_SERVICE_NAME: 'prod',
      PROD_SECRET_KEY: 'two',
      TEST_SERVICE_NAME: 'test',
    });

    expect(fingerprintA).toBe(fingerprintB);
  });
});
