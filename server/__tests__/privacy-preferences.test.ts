/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, getPrivacyPreferences, initDb, setFeatureFlag } from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

describe('privacy preferences', () => {
  const email = 'privacy-choices-test@example.com';
  let token: string;
  let userId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const endpoint = '/api/account/privacy-preferences';

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => {
    await cleanupTestUsersByEmail([email]);
    await setFeatureFlag('analytics_collection_enabled', false, null);
    await setFeatureFlag('diagnostics_user_linked_enabled', false, null);
    clearFeatureFlagCacheForTesting();
    ({ token, userId } = await registerAndLoginWebUser({
      firstName: 'Privacy', lastName: 'Test', email, password: 'privacy-test-password',
    }));
  });
  afterAll(async () => {
    await cleanupTestUsersByEmail([email]);
    await closePool();
  });

  it('starts unanswered and fail-closed, and requires authentication', async () => {
    await request(app).get(endpoint).expect(401);
    const response = await request(app).get(endpoint).set(auth()).expect(200);
    expect(response.body).toMatchObject({
      productAnalytics: null, optionalDiagnostics: null, revision: 0,
      productAnalyticsAllowed: false, optionalDiagnosticsAllowed: false,
      productCollectionEnabled: false, diagnosticsCollectionEnabled: false,
    });
    expect(response.body).not.toHaveProperty('userId');
  });

  it('records a refusal while collection is disabled and rejects grants', async () => {
    const denied = await request(app).patch(endpoint).set(auth())
      .send({ revision: 0, platform: 'web', productAnalytics: false, optionalDiagnostics: false }).expect(200);
    expect(denied.body).toMatchObject({ revision: 1, productAnalytics: false, optionalDiagnostics: false });
    expect(denied.body.productEpoch).toBe(1);
    expect(denied.body.diagnosticsEpoch).toBe(1);
    await request(app).patch(endpoint).set(auth())
      .send({ revision: 1, platform: 'web', productAnalytics: true }).expect(403);
    expect((await getPrivacyPreferences(userId)).revision).toBe(1);
  });

  it('keeps purposes separate, uses fresh flags, rotates the diagnostic pseudonym, and rejects stale writes', async () => {
    await setFeatureFlag('analytics_collection_enabled', true, null);
    await setFeatureFlag('diagnostics_user_linked_enabled', true, null);
    clearFeatureFlagCacheForTesting();
    const product = await request(app).patch(endpoint).set(auth())
      .send({ revision: 0, platform: 'web', productAnalytics: true }).expect(200);
    expect(product.body).toMatchObject({ productAnalyticsAllowed: true, optionalDiagnosticsAllowed: false, revision: 1 });
    const diagnostic = await request(app).patch(endpoint).set(auth())
      .send({ revision: 1, platform: 'ios', optionalDiagnostics: true }).expect(200);
    const firstPseudonym = diagnostic.body.diagnosticPseudonym;
    expect(firstPseudonym).toMatch(/^[0-9a-f-]{36}$/);
    expect(diagnostic.body.productAnalytics).toBe(true);
    await request(app).patch(endpoint).set(auth())
      .send({ revision: 1, platform: 'web', productAnalytics: false }).expect(409);
    const withdrawn = await request(app).patch(endpoint).set(auth())
      .send({ revision: 2, platform: 'ios', optionalDiagnostics: false }).expect(200);
    expect(withdrawn.body).toMatchObject({ optionalDiagnosticsAllowed: false, diagnosticPseudonym: null });
    const regranted = await request(app).patch(endpoint).set(auth())
      .send({ revision: 3, platform: 'ios', optionalDiagnostics: true }).expect(200);
    expect(regranted.body.diagnosticPseudonym).not.toBe(firstPseudonym);
    await setFeatureFlag('diagnostics_user_linked_enabled', false, null);
    clearFeatureFlagCacheForTesting();
    const killed = await request(app).get(endpoint).set(auth()).expect(200);
    expect(killed.body.optionalDiagnosticsAllowed).toBe(false);
    expect(killed.body.diagnosticPseudonym).toBeNull();
  });

  it('honors GPC and DNT and rejects malformed choices', async () => {
    await setFeatureFlag('analytics_collection_enabled', true, null);
    clearFeatureFlagCacheForTesting();
    await request(app).patch(endpoint).set(auth()).set('Sec-GPC', '1')
      .send({ revision: 0, platform: 'web', productAnalytics: true }).expect(403);
    await request(app).patch(endpoint).set(auth()).set('DNT', '1')
      .send({ revision: 0, platform: 'web', productAnalytics: true }).expect(403);
    await request(app).patch(endpoint).set(auth())
      .send({ revision: 0, platform: 'web', productAnalytics: 'yes' }).expect(400);
    await request(app).patch(endpoint).set(auth())
      .send({ revision: 0, platform: 'web' }).expect(400);
    const granted = await request(app).patch(endpoint).set(auth())
      .send({ revision: 0, platform: 'web', productAnalytics: true }).expect(200);
    expect(granted.body.productAnalyticsAllowed).toBe(true);
    const signaled = await request(app).get(endpoint).set(auth()).set('Sec-GPC', '1').expect(200);
    expect(signaled.body.productAnalyticsAllowed).toBe(false);
  });
});
