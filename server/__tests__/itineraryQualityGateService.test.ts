import type { ItineraryBaselineMetrics } from '../src/services/itineraryEvaluationService';
import {
  evaluateItineraryQualityGate,
  ITINERARY_QUALITY_BASELINE_SETTING_KEY,
  runItineraryQualityGateAgainstPinnedBaseline,
} from '../src/services/itineraryQualityGateService';

jest.mock('../src/db', () => ({ getAdminSetting: jest.fn() }));
const mockedGetAdminSetting = jest.requireMock('../src/db').getAdminSetting as jest.Mock;

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
  groupCohesionScore: null,
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

  describe('runItineraryQualityGateAgainstPinnedBaseline', () => {
    beforeEach(() => {
      mockedGetAdminSetting.mockReset();
    });

    it('returns null when no baseline is pinned yet (fail-open, not a hard gate)', async () => {
      mockedGetAdminSetting.mockResolvedValue(null);
      const result = await runItineraryQualityGateAgainstPinnedBaseline(metrics());
      expect(result).toBeNull();
      expect(mockedGetAdminSetting).toHaveBeenCalledWith(ITINERARY_QUALITY_BASELINE_SETTING_KEY);
    });

    it('returns null instead of throwing when the pinned value is not valid JSON', async () => {
      mockedGetAdminSetting.mockResolvedValue({ key: ITINERARY_QUALITY_BASELINE_SETTING_KEY, value: 'not json', updatedBy: null, updatedAt: '' });
      const result = await runItineraryQualityGateAgainstPinnedBaseline(metrics());
      expect(result).toBeNull();
    });

    it('compares the candidate against the pinned baseline using the looser live-monitoring thresholds', async () => {
      mockedGetAdminSetting.mockResolvedValue({
        key: ITINERARY_QUALITY_BASELINE_SETTING_KEY,
        value: JSON.stringify(metrics()),
        updatedBy: 'admin-1',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });
      // unsupportedFactRate 0.2 would fail evaluateItineraryQualityGate's own strict default
      // (maximumUnsupportedFactRate: 0) but is well under the live gate's 0.5 tolerance — proves
      // the wrapper is actually using LIVE_GATE_THRESHOLDS, not silently reusing the strict ones.
      const result = await runItineraryQualityGateAgainstPinnedBaseline(metrics({ unsupportedFactRate: 0.2 }));
      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
    });

    it('reports a failure when the candidate genuinely regresses past the live thresholds', async () => {
      mockedGetAdminSetting.mockResolvedValue({
        key: ITINERARY_QUALITY_BASELINE_SETTING_KEY,
        value: JSON.stringify(metrics()),
        updatedBy: 'admin-1',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });
      const result = await runItineraryQualityGateAgainstPinnedBaseline(metrics({ unsupportedFactRate: 0.9 }));
      expect(result?.passed).toBe(false);
      expect(result?.failures.length).toBeGreaterThan(0);
    });
  });
});
