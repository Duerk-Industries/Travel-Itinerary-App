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

  test('weightedInterestCoverage: covers only the high-weight (>=36%) dimensions that have a matching activity', () => {
    const highWeightMix = { outdoors: 10, adventure: 5, culture: 40, food: 40, nightlife: 5, relax: 0, photography: 0, authentic_local: 0, iconic_landmarks: 0 };
    const result = evaluateItineraryBaseline({
      activities: [
        { name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction', interestTags: ['culture'] },
        { name: 'Park walk', date: '2026-08-01', activityType: 'Open Access', interestTags: ['outdoors'] },
      ],
      transfers: [], mustSees: [], weights: highWeightMix, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    // culture (40%) and food (40%) are the only high-weight dims; only culture has a matching
    // activity (the museum) — food (40%) has none, so coverage is 1/2, not 2/2 or null.
    expect(result.weightedInterestCoverage).toBe(0.5);
  });

  test('weightedInterestCoverage: full coverage when every high-weight dimension has a match', () => {
    const highWeightMix = { outdoors: 0, adventure: 0, culture: 36, food: 0, nightlife: 0, relax: 0, photography: 0, authentic_local: 0, iconic_landmarks: 64 };
    const result = evaluateItineraryBaseline({
      activities: [
        { name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction', interestTags: ['culture'] },
        { name: 'Landmark tour', date: '2026-08-02', activityType: 'Tour', interestTags: ['iconic_landmarks'] },
      ],
      transfers: [], mustSees: [], weights: highWeightMix, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(result.weightedInterestCoverage).toBe(1);
  });

  test('estimatedTravelMinutesPerActivityDay: averages recorded transfer minutes across distinct activity days', () => {
    const result = evaluateItineraryBaseline({
      activities: [
        { name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction' },
        { name: 'Park', date: '2026-08-01', activityType: 'Open Access' },
        { name: 'Tour', date: '2026-08-02', activityType: 'Tour' },
      ],
      transfers: [], mustSees: [], weights, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      transferMinutesByDay: new Map([[1, 40], [2, 20]]),
    });
    // 2 distinct activity dates (2026-08-01, 2026-08-02), total 60 minutes -> 30/day.
    expect(result.estimatedTravelMinutesPerActivityDay).toBe(30);
  });

  test('estimatedTravelMinutesPerActivityDay: 0 (not null) when transferMinutesByDay is present but empty', () => {
    // The real pipeline (itineraryPromptPlanService.ts) always builds and passes this map, even
    // when it ends up empty (no consecutive geocoded pairs) — 0 correctly means "no recorded
    // inter-item travel," not "unmeasured."
    const result = evaluateItineraryBaseline({
      activities: [{ name: 'Museum', date: '2026-08-01', activityType: 'Ticketed Attraction' }],
      transfers: [], mustSees: [], weights, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      transferMinutesByDay: new Map(),
    });
    expect(result.estimatedTravelMinutesPerActivityDay).toBe(0);
  });

  test('estimatedTravelMinutesPerActivityDay: null when there are no activity days to average over', () => {
    const result = evaluateItineraryBaseline({
      activities: [],
      transfers: [], mustSees: [], weights, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
    expect(result.estimatedTravelMinutesPerActivityDay).toBeNull();
  });

  test('reports groupCohesionScore correctly when provided', () => {
    const result = evaluateItineraryBaseline({
      activities: [], transfers: [], mustSees: [], weights, comfort: 'B',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      groupCohesionScore: 0.75,
    });
    expect(result.groupCohesionScore).toBe(0.75);
  });
});
