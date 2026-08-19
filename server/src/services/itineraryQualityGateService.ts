import type { ItineraryBaselineMetrics } from './itineraryEvaluationService';
import { getAdminSetting } from '../db';
import { logError, logInfo } from '../logger';

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

// evaluateItineraryQualityGate's defaults (0% tolerance on unsupported facts, 0% on cost
// increase) are tuned for a controlled A/B comparison between two specific candidates, where any
// regression at all is worth a human look. Applied to every live generation against one pinned
// baseline, those same defaults would fail almost continuously — real evidence coverage is rarely
// 100%, and cost drifts a little run to run. These looser defaults are a starting point for
// continuous operation, not a validated business threshold; they exist so the gate reports
// something actionable (a real regression) instead of being permanently red or needing to be
// disabled. An admin who wants different tolerances can pass `thresholds` through
// ITINERARY_QUALITY_BASELINE_METRICS once that becomes configurable per-key rather than a single
// pinned JSON blob.
const LIVE_GATE_THRESHOLDS: ItineraryQualityGateThresholds = {
  minimumTransferReductionPercent: -100, // don't fail on travel-time alone in continuous mode
  maximumWeightedInterestRegression: 0.1,
  maximumUnsupportedFactRate: 0.5,
  maximumP95CostIncreasePercent: 25,
};

export const ITINERARY_QUALITY_BASELINE_SETTING_KEY = 'ITINERARY_QUALITY_BASELINE_METRICS';

/**
 * The live caller evaluateItineraryQualityGate previously had none of (see
 * docs/implementation_plans/itinerary-narrative-depth-and-validation.md's "quality gate has no
 * caller" finding). Reads an admin-pinned baseline snapshot from admin_settings — the same
 * key/value pattern ACTIVE_CORPUS_RELEASE_ID already uses — and compares the candidate against
 * it. Fail-open by design: a missing or unparsable baseline returns null (nothing to compare
 * against yet), never throws, and never blocks generation — this is an operational signal
 * surfaced in generation metrics, not a hard gate on the request path.
 */
export const runItineraryQualityGateAgainstPinnedBaseline = async (
  candidate: ItineraryBaselineMetrics
): Promise<ItineraryQualityGateResult | null> => {
  try {
    const setting = await getAdminSetting(ITINERARY_QUALITY_BASELINE_SETTING_KEY);
    if (!setting?.value) return null;
    const baseline = JSON.parse(setting.value) as ItineraryBaselineMetrics;
    if (!baseline || typeof baseline !== 'object') return null;
    const result = evaluateItineraryQualityGate({ baseline, candidate, thresholds: LIVE_GATE_THRESHOLDS });
    if (!result.passed) {
      logInfo(`[itinerary-quality-gate] candidate failed live gate: ${result.failures.join('; ')}`);
    }
    return result;
  } catch (err) {
    logError('[itinerary-quality-gate] failed to evaluate against pinned baseline; continuing without a gate result', err);
    return null;
  }
};
