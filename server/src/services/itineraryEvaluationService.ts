import type { InterestWeights } from './activityTypeInterestWeights';

export const ITINERARY_EVALUATION_VERSION = 'itinerary-eval-v1' as const;

export type EvaluationActivity = {
  name: string;
  date: string;
  activityType: string;
  cost?: string;
  notes?: string;
  interestTags?: string[];
};
export type EvaluationTransfer = { departureDate: string; arrivalDate: string; durationHours?: number | null };

export type ItineraryBaselineMetrics = {
  version: typeof ITINERARY_EVALUATION_VERSION;
  mustSeeCoverage: number | null;
  weightedInterestCoverage: number | null;
  duplicateRate: number;
  freeOrLowCostShare: number | null;
  hardConstraintViolations: number | null;
  estimatedTravelMinutesPerActivityDay: number | null;
  scheduleWindowViolations: number | null;
  arrivalDepartureFeasible: boolean | null;
  unsupportedFactRate: number | null;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  /** Fairness Floor hit rate: fraction of traveler interests served without post-hoc injection. */
  groupCohesionScore: number | null;
  unavailableReasons: string[];
};

export type BudgetMonotonicityResult = {
  valid: boolean | null;
  reason: string;
};

const normalize = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const evaluateItineraryBaseline = (input: {
  activities: EvaluationActivity[];
  transfers: EvaluationTransfer[];
  mustSees: string[];
  weights: InterestWeights;
  comfort: 'B' | 'M' | 'L';
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  stageLatenciesMs?: number[];
  transferMinutesByDay?: Map<number, number>;
  groupCohesionScore?: number | null;
}): ItineraryBaselineMetrics => {
  const names = input.activities.map((activity) => normalize(activity.name)).filter(Boolean);
  const uniqueNames = new Set(names);
  const duplicates = Math.max(0, names.length - uniqueNames.size);
  const mustSees = Array.from(new Set(input.mustSees.map(normalize).filter(Boolean)));
  const matchedMustSees = mustSees.filter((mustSee) => names.some((name) => name.includes(mustSee) || mustSee.includes(name))).length;
  const explicitCosts = input.activities.map((activity) => String(activity.cost ?? '').trim()).filter(Boolean);
  const freeCount = explicitCosts.filter((cost) => /^(0|0\.00|free|\$0)$/i.test(cost)).length;
  const latencies = [...(input.stageLatenciesMs ?? [])].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const percentile = (p: number): number | null => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] : null;

  // Weighted Interest Coverage
  const weightedInterestCoverage = (() => {
    const highInterests = Object.entries(input.weights)
      .filter(([, weight]) => weight >= 36)
      .map(([key]) => key as keyof InterestWeights);
    if (!highInterests.length) return null;

    const coveredInterests = highInterests.filter((interest) =>
      input.activities.some((activity) =>
        (activity.interestTags ?? []).some((tag) => normalize(tag).replace(/\s+/g, '_') === interest)
      )
    );
    return coveredInterests.length / highInterests.length;
  })();

  // Travel Minutes
  const totalTravelMinutes = Array.from(input.transferMinutesByDay?.values() ?? []).reduce((a, b) => a + b, 0);
  const activityDays = new Set(input.activities.map((a) => a.date)).size;
  const estimatedTravelMinutesPerActivityDay = activityDays > 0 ? totalTravelMinutes / activityDays : null;

  const unavailableReasons = [
    'Hard constraints are not yet represented as machine-checkable activity requirements.',
    'Schedule-window metrics require per-item opening hours/reservation metadata.',
    'Arrival/departure feasibility requires booked/local-time travel constraints.',
    'Unsupported-fact scoring requires evidence provenance.',
  ];

  return {
    version: ITINERARY_EVALUATION_VERSION,
    mustSeeCoverage: mustSees.length ? matchedMustSees / mustSees.length : null,
    weightedInterestCoverage,
    duplicateRate: names.length ? duplicates / names.length : 0,
    freeOrLowCostShare: explicitCosts.length ? freeCount / explicitCosts.length : null,
    hardConstraintViolations: null,
    estimatedTravelMinutesPerActivityDay,
    scheduleWindowViolations: null,
    arrivalDepartureFeasible: null,
    unsupportedFactRate: null,
    llmCalls: latencies.length,
    ...input.tokenUsage,
    latencyP50Ms: percentile(0.5), latencyP95Ms: percentile(0.95),
    groupCohesionScore: input.groupCohesionScore ?? null,
    unavailableReasons,
  };
};

export const evaluateBudgetMonotonicity = (input: {
  higherBudget: ItineraryBaselineMetrics;
  lowerBudget: ItineraryBaselineMetrics;
  addedPaidItemsAreMustSees: boolean;
}): BudgetMonotonicityResult => {
  const higher = input.higherBudget.freeOrLowCostShare;
  const lower = input.lowerBudget.freeOrLowCostShare;
  if (higher === null || lower === null) return { valid: null, reason: 'Comparable cost evidence is unavailable.' };
  if (lower >= higher) return { valid: true, reason: 'Lower budget preserved or increased the free/low-cost share.' };
  if (input.addedPaidItemsAreMustSees) return { valid: true, reason: 'Lower-cost monotonicity exception is explained by explicit must-sees.' };
  return { valid: false, reason: 'Lower budget reduced the free/low-cost share without a must-see explanation.' };
};
