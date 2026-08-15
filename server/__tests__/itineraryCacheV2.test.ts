import { cosineSimilarity, selectDeterministicItinerary } from '../src/services/itineraryCacheSelector';
import { BindingPlanSchema, ActivityBlock } from '../src/schemas/itineraryCacheSchemas';
import * as meanVectorService from '../src/services/meanVectorService';

jest.mock('../src/services/meanVectorService');

describe('Itinerary Cache v2 Logic', () => {
  const mockMean = {
    outdoors: 5.5, adventure: 5.5, culture: 5.5, food: 5.5, nightlife: 5.5,
    relaxing: 5.5, photography: 5.5, authentic_local: 5.5, iconic_landmarks: 5.5,
  };

  beforeEach(() => {
    (meanVectorService.getMeanVector as jest.Mock).mockResolvedValue(mockMean);
  });

  const mockBlocks: ActivityBlock[] = [
    {
      block_id: 'blk_1', location_id: 'loc_1', zone_id: 'z1', role: 'anchor', title: 'Museum',
      category: 'culture', energy_cost: 2, duration_minutes: { typical: 90, min: 60, max: 120 },
      interest_weights: {
        outdoors: 1, adventure: 1, culture: 10, food: 1, nightlife: 1,
        relaxing: 1, photography: 1, authentic_local: 1, iconic_landmarks: 1,
      },
      copy: { teaser: 'T', body: 'B', insider_tip: 'I', etiquette: null, priority_signal: 'dont_skip' },
      timing: { optimal_arrival: null, hard_deadline: null, time_box: null, after_dark_value: false },
      cost_band: { currency: 'EUR', low: 10, high: 20, note: null },
      source: 'curated', last_verified: '2026-08-14',
    },
    {
      block_id: 'blk_2', location_id: 'loc_1', zone_id: 'z1', role: 'meal', title: 'Cafe',
      category: 'food', energy_cost: 1, duration_minutes: { typical: 60, min: 45, max: 90 },
      interest_weights: {
        outdoors: 2, adventure: 1, culture: 2, food: 10, nightlife: 2,
        relaxing: 5, photography: 4, authentic_local: 8, iconic_landmarks: 3,
      },
      copy: { teaser: 'T', body: 'B', insider_tip: 'I', etiquette: null, priority_signal: 'optional' },
      timing: { optimal_arrival: null, hard_deadline: null, time_box: null, after_dark_value: false },
      cost_band: { currency: 'EUR', low: 5, high: 15, note: null },
      source: 'curated', last_verified: '2026-08-14',
    },
  ];

  it('calculates mean-centered cosine similarity correctly', () => {
    const userWeights = {
      outdoors: 1, adventure: 1, culture: 10, food: 1, nightlife: 1,
      relaxing: 1, photography: 1, authentic_local: 1, iconic_landmarks: 1,
    };
    const score = cosineSimilarity(mockBlocks[0].interest_weights, userWeights, mockMean);
    // Identical relative weights should yield +1.0
    expect(score).toBeCloseTo(1.0, 5);

    const unlikeWeights = {
      outdoors: 10, adventure: 10, culture: 1, food: 10, nightlife: 10,
      relaxing: 10, photography: 10, authentic_local: 10, iconic_landmarks: 10,
    };
    const badScore = cosineSimilarity(mockBlocks[0].interest_weights, unlikeWeights, mockMean);
    expect(badScore).toBeLessThan(-0.5);
  });

  it('selects blocks deterministically based on fit', async () => {
    const userWeights = {
      outdoors: 1, adventure: 1, culture: 10, food: 1, nightlife: 1,
      relaxing: 1, photography: 1, authentic_local: 1, iconic_landmarks: 1,
    };
    const plan = await selectDeterministicItinerary({
      blocks: mockBlocks,
      userWeights,
      days: 1,
    });

    expect(plan).not.toBeNull();
    expect(plan!.days).toHaveLength(1);
    expect(plan!.days[0].bindings.s1).toBe('blk_1');
    expect(plan!.days[0].bindings.s2).toBe('blk_2');

    // Schema validation
    const validation = BindingPlanSchema.safeParse(plan);
    expect(validation.success).toBe(true);
  });
});
