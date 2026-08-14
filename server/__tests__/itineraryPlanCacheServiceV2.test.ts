import {
  buildCacheKeyV2,
  CacheCompatibilityProjectionSchema,
  validatePrivateConstraints,
} from '../src/services/itineraryPlanCacheServiceV2';

const projection = {
  schema_version: 'binding-plan-v2' as const,
  algorithm_version: 'selector-1',
  corpus_release_id: 'release-1',
  template_revision: 'template-1',
  destinations: ['brasov', 'sibiu'],
  duration_bucket: 8,
  local_date_shape: 'summer-week',
  season_label: 'summer',
  pace: 'balanced',
  party_class: 'adults',
  mobility_class: 'standard',
  interest_signature: 'abc123',
};

describe('binding-plan-v2 cache safety', () => {
  it('produces stable keys and rejects private/unknown projection fields', () => {
    expect(buildCacheKeyV2(projection)).toBe(buildCacheKeyV2({ ...projection, destinations: [...projection.destinations] }));
    expect(CacheCompatibilityProjectionSchema.safeParse({ ...projection, user_id: 'private' }).success).toBe(false);
  });

  it('produces the same key regardless of input field order (the canonical projection, not the raw object, is hashed)', () => {
    const reordered = Object.fromEntries(Object.entries(projection).reverse()) as typeof projection;
    expect(buildCacheKeyV2(reordered)).toBe(buildCacheKeyV2(projection));
  });

  it('produces a different key when a semantically meaningful field differs', () => {
    expect(buildCacheKeyV2({ ...projection, pace: 'relaxed' })).not.toBe(buildCacheKeyV2(projection));
  });

  it('revalidates bound blocks against private energy and accessibility constraints', () => {
    const block = {
      block_id: 'blk_hike', location_id: 'loc_brasov', zone_id: 'zone_a', role: 'anchor' as const,
      category: 'hike', title: 'Trail', name_local: null, name_script: null,
      copy: { teaser: '', body: '', insider_tip: '', etiquette: null, priority_signal: 'optional' as const },
      timing: { optimal_arrival: null, hard_deadline: null, time_box: null, after_dark_value: false },
      cost_band: { currency: 'EUR', low: 0, high: 0, note: null },
      duration_minutes: { typical: 120, min: 60, max: 180 }, energy_cost: 3,
      interest_weights: { outdoors: 10, adventure: 8, culture: 1, food: 1, nightlife: 1, relaxing: 3, photography: 5, authentic_local: 4, iconic_landmarks: 2 },
      source: 'curated' as const, last_verified: null,
    };
    const plan = { days: [{ day: 1, template: 'day', bindings: { anchor: 'blk_hike' }, zone_focus: 'zone_a', reason_codes: [] }] };
    expect(validatePrivateConstraints(plan, { maxEnergyPerDay: 4, requireStepFree: false, blocks: { blk_hike: block } })).toBe(true);
    expect(validatePrivateConstraints(plan, { maxEnergyPerDay: 2, requireStepFree: false, blocks: { blk_hike: block } })).toBe(false);
    expect(validatePrivateConstraints(plan, { maxEnergyPerDay: 4, requireStepFree: false, blocks: {} })).toBe(false);
  });
});

