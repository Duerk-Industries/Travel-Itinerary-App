/// <reference types="jest" />
import request from 'supertest';

process.env.DB_PROVIDER = 'memory';
process.env.USE_IN_MEMORY_DB = '1';
process.env.DATABASE_URL = 'pg-mem://localhost/test';

import { initDb, setFeatureFlag } from '../src/db';
import { app } from '../src/app';

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
});
