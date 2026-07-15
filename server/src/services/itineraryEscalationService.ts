import { getApiCacheSetting } from '../config/apiLimits';

export type ItineraryEscalationReason = 'long_trip' | 'many_destinations' | 'low_shortlist_coverage' | 'repair_failure';

export type ItineraryEscalationInput = {
  days: number;
  destinationCount: number;
  shortlistCoverage: number | null;
  repairFailed?: boolean;
  provider?: string;
};

export type ItineraryEscalationDecision = {
  enabled: boolean;
  shouldEscalate: boolean;
  model: string | null;
  reasons: ItineraryEscalationReason[];
};

const numberSetting = (key: string, fallback: number): number => {
  const value = Number(getApiCacheSetting('itineraryPlan', key));
  return Number.isFinite(value) ? value : fallback;
};

/**
 * Decide whether only the content-generation stage should use a stronger model.
 * This function is deliberately pure from the caller's perspective: all knobs
 * come from api-limits.yaml, and it never makes a provider call itself.
 */
export const decideItineraryEscalation = (input: ItineraryEscalationInput): ItineraryEscalationDecision => {
  const enabled = numberSetting('escalationEnabled', 0) > 0;
  const reasons: ItineraryEscalationReason[] = [];
  if (input.days >= numberSetting('escalationMinDays', 10)) reasons.push('long_trip');
  if (input.destinationCount >= numberSetting('escalationMinDestinations', 3)) reasons.push('many_destinations');
  const coverageThreshold = numberSetting('escalationMinCoveragePercent', 0.5);
  if (input.shortlistCoverage !== null && input.shortlistCoverage < coverageThreshold) reasons.push('low_shortlist_coverage');
  if (input.repairFailed) reasons.push('repair_failure');

  // The configured stronger model must be compatible with the active provider.
  // A missing/unsupported provider falls back to the existing cheap path.
  const provider = String(input.provider ?? 'openai').toLowerCase();
  const configuredModel = Number(getApiCacheSetting('itineraryPlan', 'escalationModel')) === 1 ? 'gpt-4o' : '';
  const compatible = provider === 'openai' && configuredModel.length > 0;
  return {
    enabled,
    shouldEscalate: enabled && compatible && reasons.length > 0,
    model: compatible ? configuredModel : null,
    reasons,
  };
};
