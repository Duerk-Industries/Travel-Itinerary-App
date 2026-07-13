import { enforceBudgetTierCoherence } from '../src/services/itineraryPromptPlanService';

const entry = (name: string, tier: 'free' | 'paid' | 'premium', rank: number) => ({
  id: name, destinationKey: 'paris', destinationDisplayName: 'Paris', name, rank,
  activityType: 'Open Access' as const, interestTags: ['culture'] as any, budgetTier: tier,
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('itinerary comfort-tier coherence', () => {
  test('replaces premium choices for Budget while retaining an explicit must-see', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'A', 'Luxury Museum'], ['E', 'O', 'Must See Tower']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] }],
    } as any;
    const result = enforceBudgetTierCoherence(itinerary, { Paris: [entry('Free Garden', 'free', 1), entry('Luxury Museum', 'premium', 2), entry('Must See Tower', 'premium', 3)] }, 'B', ['Must See Tower']);
    expect(result.dy[0].it[0][2]).toBe('Free Garden');
    expect(result.dy[0].it[1][2]).toBe('Must See Tower');
  });

  test('replaces free choices for Luxury when a paid alternative exists', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'O', 'Free Garden']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] }],
    } as any;
    const result = enforceBudgetTierCoherence(itinerary, { Paris: [entry('Free Garden', 'free', 1), entry('Paid Museum', 'paid', 2)] }, 'L', []);
    expect(result.dy[0].it[0][2]).toBe('Paid Museum');
  });
});
