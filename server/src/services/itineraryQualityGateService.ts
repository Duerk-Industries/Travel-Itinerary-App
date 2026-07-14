import type { ItineraryBaselineMetrics } from './itineraryEvaluationService';

export type ItineraryQualityGateThresholds = {
  minimumTransferReductionPercent: number;
  maximumWeightedInterestRegression: number;
  maximumUnsupportedFactRate: number;
  maximumP95CostIncreasePercent: number;
};

export type ItineraryQualityGateInput = {
  baseline: ItineraryBaselineMetrics;
  candidate: ItineraryBaselineMetrics;
  baselineP95CostMicros?: number | null;
  candidateP95CostMicros?: number | null;
  thresholds?: Partial<ItineraryQualityGateThresholds>;
};

export type ItineraryQualityGateResult = {
  passed: boolean;
  transferReductionPercent: number | null;
  weightedInterestRegression: number | null;
  p95CostIncreasePercent: number | null;
  failures: string[];
};

const DEFAULT_THRESHOLDS: ItineraryQualityGateThresholds = {
  minimumTransferReductionPercent: 20,
  maximumWeightedInterestRegression: 0.02,
  maximumUnsupportedFactRate: 0,
  maximumP95CostIncreasePercent: 0,
};

const percentChange = (before: number, after: number): number | null => {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  return ((after - before) / before) * 100;
};

export const evaluateItineraryQualityGate = (input: ItineraryQualityGateInput): ItineraryQualityGateResult => {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const failures: string[] = [];
  const baselineTravel = input.baseline.estimatedTravelMinutesPerActivityDay;
  const candidateTravel = input.candidate.estimatedTravelMinutesPerActivityDay;
  const transferReductionPercent = baselineTravel !== null && candidateTravel !== null && baselineTravel > 0
    ? ((baselineTravel - candidateTravel) / baselineTravel) * 100
    : null;
  if (transferReductionPercent !== null && transferReductionPercent < thresholds.minimumTransferReductionPercent) {
    failures.push(`transfer reduction ${transferReductionPercent.toFixed(2)}% is below ${thresholds.minimumTransferReductionPercent}%`);
  }

  const baselineCoverage = input.baseline.weightedInterestCoverage;
  const candidateCoverage = input.candidate.weightedInterestCoverage;
  const weightedInterestRegression = baselineCoverage !== null && candidateCoverage !== null
    ? baselineCoverage - candidateCoverage
    : null;
  if (weightedInterestRegression !== null && weightedInterestRegression > thresholds.maximumWeightedInterestRegression) {
    failures.push(`weighted-interest regression ${weightedInterestRegression.toFixed(3)} exceeds ${thresholds.maximumWeightedInterestRegression.toFixed(3)}`);
  }

  const unsupportedFactRate = input.candidate.unsupportedFactRate;
  if (unsupportedFactRate !== null && unsupportedFactRate > thresholds.maximumUnsupportedFactRate) {
    failures.push(`unsupported-fact rate ${unsupportedFactRate.toFixed(3)} exceeds ${thresholds.maximumUnsupportedFactRate.toFixed(3)}`);
  }

  const p95CostIncreasePercent = input.baselineP95CostMicros != null && input.candidateP95CostMicros != null
    ? percentChange(input.baselineP95CostMicros, input.candidateP95CostMicros)
    : null;
  if (p95CostIncreasePercent !== null && p95CostIncreasePercent > thresholds.maximumP95CostIncreasePercent) {
    failures.push(`p95 cost increase ${p95CostIncreasePercent.toFixed(2)}% exceeds ${thresholds.maximumP95CostIncreasePercent}%`);
  }

  return { passed: failures.length === 0, transferReductionPercent, weightedInterestRegression, p95CostIncreasePercent, failures };
};
