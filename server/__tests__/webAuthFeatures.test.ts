/// <reference types="jest" />
import request from 'supertest';

process.env.DB_PROVIDER = 'memory';
process.env.USE_IN_MEMORY_DB = '1';
process.env.DATABASE_URL = 'pg-mem://localhost/test';

import { initDb, setFeatureFlag } from '../src/db';
import { app } from '../src/app';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

describe('GET /api/auth/features', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('reports the UX-remediation kill switches alongside the existing grid-editing flags', async () => {
    await setFeatureFlag('feature_tap_to_edit_tables', true, null);
    await setFeatureFlag('feature_cover_photo_fallback_v2', true, null);
    await setFeatureFlag('feature_quick_start_trip_wizard', true, null);

    const res = await request(app).get('/api/auth/features');

    expect(res.status).toBe(200);
    expect(res.body.featureTapToEditTables).toBe(true);
    expect(res.body.featureCoverPhotoFallbackV2).toBe(true);
    expect(res.body.featureQuickStartTripWizard).toBe(true);
    // Existing flags stay present alongside the new ones — this endpoint is additive, not a replacement.
    expect(res.body).toHaveProperty('featureGridEditing');
    expect(res.body).toHaveProperty('featureStandardizedItemDialogs');
  });

  it('reports each kill switch as false once explicitly disabled', async () => {
    await setFeatureFlag('feature_tap_to_edit_tables', false, null);
    await setFeatureFlag('feature_cover_photo_fallback_v2', false, null);
    await setFeatureFlag('feature_quick_start_trip_wizard', false, null);

    const res = await request(app).get('/api/auth/features');

    expect(res.status).toBe(200);
    expect(res.body.featureTapToEditTables).toBe(false);
    expect(res.body.featureCoverPhotoFallbackV2).toBe(false);
    expect(res.body.featureQuickStartTripWizard).toBe(false);
  });

  it('reports itinerary reactions/item-kinds so the client can hide the UI instead of hitting a 403', async () => {
    await setFeatureFlag('itinerary_reactions', false, null);
    await setFeatureFlag('itinerary_item_kinds', false, null);
    clearFeatureFlagCacheForTesting();

    const disabledRes = await request(app).get('/api/auth/features');
    expect(disabledRes.body.featureItineraryReactions).toBe(false);
    expect(disabledRes.body.featureItineraryItemKinds).toBe(false);

    await setFeatureFlag('itinerary_reactions', true, null);
    await setFeatureFlag('itinerary_item_kinds', true, null);
    clearFeatureFlagCacheForTesting();

    const enabledRes = await request(app).get('/api/auth/features');
    expect(enabledRes.body.featureItineraryReactions).toBe(true);
    expect(enabledRes.body.featureItineraryItemKinds).toBe(true);
  });

  it('reports Plaid as unavailable unless both Plaid rollout flags are enabled', async () => {
    await setFeatureFlag('expense_import_plaid', false, null);
    await setFeatureFlag('expense_import_plaid_link', false, null);
    clearFeatureFlagCacheForTesting();

    const disabledRes = await request(app).get('/api/auth/features');
    expect(disabledRes.body.featureExpenseImportPlaid).toBe(false);

    await setFeatureFlag('expense_import_plaid', true, null);
    await setFeatureFlag('expense_import_plaid_link', true, null);
    clearFeatureFlagCacheForTesting();

    const enabledRes = await request(app).get('/api/auth/features');
    expect(enabledRes.body.featureExpenseImportPlaid).toBe(true);
  });

  it('reports the itinerary document import rollout flag', async () => {
    await setFeatureFlag('itinerary_document_import', false, null);
    clearFeatureFlagCacheForTesting();
    const disabledRes = await request(app).get('/api/auth/features');
    expect(disabledRes.body.featureItineraryDocumentImport).toBe(false);

    await setFeatureFlag('itinerary_document_import', true, null);
    clearFeatureFlagCacheForTesting();
    const enabledRes = await request(app).get('/api/auth/features');
    expect(enabledRes.body.featureItineraryDocumentImport).toBe(true);
  });
});
