const fs = require('fs');
const crypto = require('crypto');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const requiredManifestFields = [
  'gitSha',
  'backendImageDigest',
  'frontendArtifact',
  'frontendSha256',
  'firestoreIndexesSha256',
  'configFingerprint',
  'builtAt',
  'builderRunId',
];

const validateReleaseManifest = (manifest) => {
  const missing = requiredManifestFields.filter((field) => !manifest[field]);
  if (missing.length) throw new Error(`Release manifest missing fields: ${missing.join(', ')}`);
  if (!/^[a-f0-9]{7,40}$/i.test(String(manifest.gitSha))) throw new Error('Release manifest gitSha is invalid');
  if (!String(manifest.backendImageDigest).includes('@sha256:')) throw new Error('Release manifest backendImageDigest must be digest-pinned');
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.frontendSha256))) throw new Error('Release manifest frontendSha256 must be sha256 hex');
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.firestoreIndexesSha256))) throw new Error('Release manifest firestoreIndexesSha256 must be sha256 hex');
  return true;
};

const validateTestEvidence = (manifest, evidence) => {
  if (evidence.status !== 'passed') throw new Error('Test evidence did not pass');
  if (evidence.testedBackendImageDigest !== manifest.backendImageDigest) throw new Error('Evidence backend digest mismatch');
  if (evidence.testedFrontendSha256 !== manifest.frontendSha256) throw new Error('Evidence frontend checksum mismatch');
  if (evidence.configFingerprint !== manifest.configFingerprint) throw new Error('Evidence config fingerprint mismatch');
  if (!evidence.testedServiceUrl) throw new Error('Evidence missing tested service URL');
  return true;
};

const assertEnvironmentIsolation = (config) => {
  if (!config.TEST_FIRESTORE_DATABASE_ID || !config.PROD_FIRESTORE_DATABASE_ID) throw new Error('Missing Firestore database IDs');
  if (!config.TEST_AI_CAPTURE_BUCKET || !config.PROD_AI_CAPTURE_BUCKET) throw new Error('Missing AI capture buckets');
  if (config.TEST_FIRESTORE_DATABASE_ID === config.PROD_FIRESTORE_DATABASE_ID) throw new Error('Test and prod Firestore database IDs must differ');
  if (config.TEST_AI_CAPTURE_BUCKET === config.PROD_AI_CAPTURE_BUCKET) throw new Error('Test and prod AI capture buckets must differ');
  return true;
};

const configFingerprint = (config) => {
  const allow = Object.keys(config)
    .filter((key) => /^(TEST|PROD|ARTIFACT_REGISTRY|ROLLBACK)_/.test(key))
    .filter((key) => !/SECRET|TOKEN|KEY|PASSWORD/i.test(key))
    .sort()
    .map((key) => `${key}=${config[key] ?? ''}`)
    .join('\n');
  return crypto.createHash('sha256').update(allow).digest('hex');
};

module.exports = {
  assertEnvironmentIsolation,
  configFingerprint,
  readJson,
  validateReleaseManifest,
  validateTestEvidence,
};
