describe('P0 external-work flags', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.DB_PROVIDER = 'memory'; process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = 'pg-mem://localhost/gap-flags';
    await (require('../src/db') as typeof import('../src/db')).initDb();
  });
  it('fails closed for missing mailbox/map-artifact/push flags and preserves unrelated fail-open behavior', async () => {
    const db = require('../src/db') as typeof import('../src/db');
    const service = require('../src/services/entitlementService') as typeof import('../src/services/entitlementService');
    for (const key of ['feature_ingest_forwarded_mailbox', 'trip_blog_day_map_render', 'notifications_web_push']) {
      await db.poolClient().query('DELETE FROM feature_flags WHERE key=$1', [key]);
      service.clearFeatureFlagCacheForTesting();
      expect(await service.isFeatureEnabled(key)).toBe(false);
    }
    expect(await service.isFeatureEnabled('unrelated_legacy_feature')).toBe(true);
  });
});
