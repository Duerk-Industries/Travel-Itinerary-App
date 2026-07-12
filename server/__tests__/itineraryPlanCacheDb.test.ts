import { getItineraryPlanCacheEntry, initDb, upsertItineraryPlanCacheEntry } from '../src/db';

describe('Phase 4 itinerary plan cache persistence', () => {
  beforeAll(async () => initDb());

  test('round-trips a cache entry through the active database adapter', async () => {
    const entry = {
      id: 'it-plan:route:db-roundtrip', cacheKey: 'it-plan:route:db-roundtrip', stage: 'route' as const,
      signature: 'signature', dependencyFingerprint: 'dependency', payload: { route: true }, fragments: [],
      expiresAt: '2099-01-01T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    await upsertItineraryPlanCacheEntry(entry);
    expect(await getItineraryPlanCacheEntry(entry.cacheKey)).toMatchObject({
      cacheKey: entry.cacheKey, stage: 'route', signature: 'signature', dependencyFingerprint: 'dependency', payload: { route: true },
    });
  });
});

