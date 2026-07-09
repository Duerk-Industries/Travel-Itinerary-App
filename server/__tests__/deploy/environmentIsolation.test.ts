/// <reference types="jest" />

const validators = require('../../../scripts/lib/phase11-validators');

describe('Phase 11 environment isolation', () => {
  it('requires test and production Firestore and AI capture storage to differ', () => {
    expect(() => validators.assertEnvironmentIsolation({
      TEST_FIRESTORE_DATABASE_ID: 'travel-itinerary-app-test-database',
      PROD_FIRESTORE_DATABASE_ID: 'travel-itinerary-app-database',
      TEST_AI_CAPTURE_BUCKET: 'test-captures',
      PROD_AI_CAPTURE_BUCKET: 'prod-captures',
    })).not.toThrow();
  });

  it('rejects shared capture buckets', () => {
    expect(() => validators.assertEnvironmentIsolation({
      TEST_FIRESTORE_DATABASE_ID: 'test-db',
      PROD_FIRESTORE_DATABASE_ID: 'prod-db',
      TEST_AI_CAPTURE_BUCKET: 'same',
      PROD_AI_CAPTURE_BUCKET: 'same',
    })).toThrow(/AI capture buckets must differ/);
  });
});
