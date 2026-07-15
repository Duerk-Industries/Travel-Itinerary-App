import type { ItineraryBaselineMetrics } from '../src/services/itineraryEvaluationService';
import { evaluateItineraryQualityGate } from '../src/services/itineraryQualityGateService';

const metrics = (overrides: Partial<ItineraryBaselineMetrics> = {}): ItineraryBaselineMetrics => ({
  version: 'itinerary-eval-v1',
  mustSeeCoverage: 1,
  weightedInterestCoverage: 1,
  duplicateRate: 0,
  freeOrLowCostShare: 0.5,
  hardConstraintViolations: 0,
  estimatedTravelMinutesPerActivityDay: 100,
  scheduleWindowViolations: 0,
  arrivalDepartureFeasible: true,
  unsupportedFactRate: 0,
  llmCalls: 4,
  promptTokens: 100,
  completionTokens: 100,
  totalTokens: 200,
  latencyP50Ms: 100,
  latencyP95Ms: 200,
  unavailableReasons: [],
  ...overrides,
});

describe('itineraryQualityGateService', () => {
  it('passes the default improvement gate', () => {
    const result = evaluateItineraryQualityGate({
      baseline: metrics(),
      candidate: metrics({ estimatedTravelMinutesPerActivityDay: 75, weightedInterestCoverage: 0.99 }),
      baselineP95CostMicros: 100,
      candidateP95CostMicros: 100,
    });
    expect(result.passed).toBe(true);
    expect(result.transferReductionPercent).toBe(25);
  });

  it('reports transfer, relevance, unsupported-fact, and cost regressions', () => {
    const result = evaluateItineraryQualityGate({
      baseline: metrics(),
      candidate: metrics({ estimatedTravelMinutesPerActivityDay: 95, weightedInterestCoverage: 0.9, unsupportedFactRate: 0.1 }),
      baselineP95CostMicros: 100,
      candidateP95CostMicros: 125,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(4);
  });

  it('does not fabricate a comparison when baseline data is unavailable', () => {
    const result = evaluateItineraryQualityGate({
      baseline: metrics({ estimatedTravelMinutesPerActivityDay: null, weightedInterestCoverage: null }),
      candidate: metrics({ estimatedTravelMinutesPerActivityDay: null, weightedInterestCoverage: null }),
    });
    expect(result.passed).toBe(true);
    expect(result.transferReductionPercent).toBeNull();
  });
});
