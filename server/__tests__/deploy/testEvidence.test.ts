/// <reference types="jest" />

const validators = require('../../../scripts/lib/phase11-validators');

describe('Phase 11 test evidence validation', () => {
  const manifest = {
    backendImageDigest: 'repo/backend@sha256:abc',
    frontendSha256: 'a'.repeat(64),
    configFingerprint: 'fingerprint',
  };

  it('requires evidence to match the exact backend digest and frontend checksum', () => {
    expect(() => validators.validateTestEvidence(manifest, {
      status: 'passed',
      testedBackendImageDigest: manifest.backendImageDigest,
      testedFrontendSha256: manifest.frontendSha256,
      configFingerprint: manifest.configFingerprint,
      testedServiceUrl: 'https://test.duerk.org',
    })).not.toThrow();
  });

  it('rejects mismatched backend evidence', () => {
    expect(() => validators.validateTestEvidence(manifest, {
      status: 'passed',
      testedBackendImageDigest: 'repo/backend@sha256:other',
      testedFrontendSha256: manifest.frontendSha256,
      configFingerprint: manifest.configFingerprint,
      testedServiceUrl: 'https://test.duerk.org',
    })).toThrow(/backend digest mismatch/);
  });
});
