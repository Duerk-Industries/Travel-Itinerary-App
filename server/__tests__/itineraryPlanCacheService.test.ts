import {
  buildCacheKey, buildCatalogFingerprint, buildDayFragments, buildPromptFingerprint, buildTripSignature,
  readItineraryPlanCache, writeItineraryPlanCache,
} from '../src/services/itineraryPlanCacheService';

jest.mock('../src/db', () => ({ getItineraryPlanCacheEntry: jest.fn(), upsertItineraryPlanCacheEntry: jest.fn(async (entry) => entry) }));
const db = jest.requireMock('../src/db') as { getItineraryPlanCacheEntry: jest.Mock; upsertItineraryPlanCacheEntry: jest.Mock };

const base = { destinations: ['Paris', 'Lyon'], duration: 7, pace: 'B', comfort: 'M', mobility: 'M', car: 'P', interactionStyle: 'mixed', budgetMin: 1000, budgetMax: 2500, startDate: '2026-08-01', endDate: '2026-08-07', startHub: 'BOS', endHub: 'CDG', weights: { culture: 50 } };

describe('Phase 4 itinerary plan cache', () => {
  beforeEach(() => { db.getItineraryPlanCacheEntry.mockReset(); db.upsertItineraryPlanCacheEntry.mockClear(); });

  test('signature changes for planning traits and hubs but has no must-see/user dimension', () => {
    const signature = buildTripSignature(base, false);
    expect(buildTripSignature({ ...base }, false)).toBe(signature);
    expect(buildTripSignature({ ...base, pace: 'R' }, false)).not.toBe(signature);
    expect(buildTripSignature({ ...base, comfort: 'B' }, false)).not.toBe(signature);
    expect(buildTripSignature({ ...base, mobility: 'L' }, false)).not.toBe(signature);
    expect(buildTripSignature({ ...base, startHub: 'JFK' }, false)).not.toBe(signature);
    expect(JSON.stringify(base)).not.toContain('userId');
    expect(JSON.stringify(base)).not.toContain('mustSee');
  });

  test('catalog coordinates invalidate dependent cache keys', () => {
    const row = { id: 'a', destinationKey: 'paris', destinationDisplayName: 'Paris', name: 'Museum', rank: 1, activityType: 'Ticketed Attraction' as const, interestTags: ['culture'] as any, lat: 48.8, lon: 2.3, updatedAt: 'x' };
    const first = buildCatalogFingerprint({ Paris: [row] });
    const moved = buildCatalogFingerprint({ Paris: [{ ...row, lat: 49.1 }] });
    expect(moved).not.toBe(first);
    expect(buildCacheKey('day', 'sig', first)).not.toBe(buildCacheKey('day', 'sig', moved));
  });

  test('catalog content changes invalidate dependent cache keys', () => {
    const row = { id: 'a', destinationKey: 'paris', destinationDisplayName: 'Paris', name: 'Museum', rank: 1, activityType: 'Ticketed Attraction' as const, interestTags: ['culture'] as any, budgetTier: 'paid' as const, updatedAt: 'x' };
    const first = buildCatalogFingerprint({ Paris: [row] });
    expect(buildCatalogFingerprint({ Paris: [{ ...row, name: 'Renamed Museum' }] })).not.toBe(first);
    expect(buildCatalogFingerprint({ Paris: [{ ...row, interestTags: ['food'] as any }] })).not.toBe(first);
    expect(buildCatalogFingerprint({ Paris: [{ ...row, wikipediaSummary: 'Updated verified summary' }] })).not.toBe(first);
  });

  test('Phase 3 pod, logistics, and validator changes invalidate day dependencies', () => {
    const baseDependency = { p2: 'prompt', p3: 'validator', attractionPodsBlock: 'pod A', logisticsFactsBlock: 'arrival max 1', structureValidator: 'v1' };
    const original = buildPromptFingerprint(baseDependency);
    expect(buildPromptFingerprint({ ...baseDependency, attractionPodsBlock: 'pod B' })).not.toBe(original);
    expect(buildPromptFingerprint({ ...baseDependency, logisticsFactsBlock: 'departure max 0' })).not.toBe(original);
    expect(buildPromptFingerprint({ ...baseDependency, structureValidator: 'v2' })).not.toBe(original);
  });

  test('writes triplets and rejects expired entries', async () => {
    const written = await writeItineraryPlanCache({ stage: 'day', signature: 'sig', dependencyFingerprint: 'dep', payload: { dy: [1, 2, 3, 4] }, fragments: buildDayFragments([1, 2, 3, 4]), ttlDays: 30, now: new Date('2026-01-01T00:00:00Z') });
    expect(written.fragments).toEqual([[1, 2, 3], [4]]);
    db.getItineraryPlanCacheEntry.mockResolvedValue(written);
    expect(await readItineraryPlanCache({ stage: 'day', signature: 'sig', dependencyFingerprint: 'dep', now: new Date('2026-02-01T00:00:00Z') })).toBeNull();
  });

  test('explicitly misses when pace, comfort, or mobility signature differs', async () => {
    const oldSignature = buildTripSignature(base, false);
    db.getItineraryPlanCacheEntry.mockResolvedValue({
      id: 'old', cacheKey: 'old', stage: 'route', signature: oldSignature, dependencyFingerprint: 'dep',
      payload: { cached: true }, fragments: [], expiresAt: '2099-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });
    for (const changed of [{ ...base, pace: 'R' }, { ...base, comfort: 'B' }, { ...base, mobility: 'L' }]) {
      expect(await readItineraryPlanCache({ stage: 'route', signature: buildTripSignature(changed, false), dependencyFingerprint: 'dep' })).toBeNull();
    }
  });
});
