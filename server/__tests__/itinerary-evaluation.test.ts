import { evaluateBudgetMonotonicity, evaluateItineraryBaseline } from '../src/services/itineraryEvaluationService';

const weights = { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 };

describe('itinerary Phase 0A baseline evaluation', () => {
  test('calculates structured evidence-backed metrics and marks unavailable metrics explicitly', () => {
    const result = evaluateItineraryBaseline({
      activities: [
        { name: 'Museo Nacional de Antropología', date: '2026-08-01', activityType: 'Ticketed Attraction', cost: '$20' },
        { name: 'Museo Nacional de Antropologia', date: '2026-08-02', activityType: 'Ticketed Attraction', cost: '$20' },
        { name: 'Bosque de Chapultepec', date: '2026-08-02', activityType: 'Open Access', cost: 'Free' },
      ],
      transfers: [], mustSees: ['Museo Nacional de Antropologia', 'Palacio de Bellas Artes'],
      weights, comfort: 'B', tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      stageLatenciesMs: [100, 500, 200, 400, 300],
    });
    expect(result.mustSeeCoverage).toBe(0.5);
    expect(result.duplicateRate).toBeCloseTo(1 / 3);
    expect(result.freeOrLowCostShare).toBeCloseTo(1 / 3);
    expect(result.latencyP50Ms).toBe(300);
    expect(result.latencyP95Ms).toBe(500);
    expect(result.weightedInterestCoverage).toBeNull();
    expect(result.unavailableReasons.length).toBeGreaterThan(0);
  });

  test('flags a lower-budget plan that reduces low-cost share without a must-see reason', () => {
    const common = { transfers: [], mustSees: [], weights, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    const higherBudget = evaluateItineraryBaseline({ ...common, comfort: 'M', activities: [
      { name: 'Park', date: '2026-08-01', activityType: 'Open Access', cost: 'Free' },
      { name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction', cost: '$30' },
    ] });
    const lowerBudget = evaluateItineraryBaseline({ ...common, comfort: 'B', activities: [
      { name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction', cost: '$30' },
      { name: 'Tour', date: '2026-08-02', activityType: 'Tour', cost: '$40' },
    ] });
    expect(evaluateBudgetMonotonicity({ higherBudget, lowerBudget, addedPaidItemsAreMustSees: false })).toEqual({
      valid: false,
      reason: 'Lower budget reduced the free/low-cost share without a must-see explanation.',
    });
    expect(evaluateBudgetMonotonicity({ higherBudget, lowerBudget, addedPaidItemsAreMustSees: true }).valid).toBe(true);
  });
});
