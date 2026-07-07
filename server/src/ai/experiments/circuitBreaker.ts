import { getAdminSetting, reassignAiExperimentVariantToControl } from '../../db';
import { logError } from '../../logger';

// KNOWN LIMITATION: counters are in-process, not DB-backed. Correct and
// sufficient for this app's current single-instance deployment (confirmed:
// no load balancer/multi-replica setup exists yet). If this ever runs
// multi-instance, a failing variant's traffic gets sharded across
// processes and may never accumulate enough failures in any single
// process to trip — and a process restart silently zeroes counters
// instead of resetting only at experiment start. Move to a DB-backed
// atomic counter (`UPDATE ... SET count = count + 1 RETURNING count`,
// same technique `usageLimiter.ts` uses) before this app is ever deployed
// multi-instance; tracked as a follow-up, not fixed here.
type Counter = { requestCount: number; failureCount: number; tripped: boolean };
const counters = new Map<string, Counter>();

const keyFor = (experimentId: string, variantId: string) => `${experimentId}:${variantId}`;

const DEFAULT_MIN_REQUESTS = 20;
const DEFAULT_FAILURE_RATE_THRESHOLD = 0.25;

// admin_settings-backed, not hardcoded — an operator watching a live
// experiment needs to be able to loosen/tighten these without a deploy.
const readThresholdSetting = async (key: string, fallback: number): Promise<number> => {
  const row = await getAdminSetting(key);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const recordExperimentVariantOutcome = async (params: {
  experimentId: string;
  variantId: string;
  controlVariantId: string;
  success: boolean;
  minRequests?: number;
  failureRateThreshold?: number;
}): Promise<{ tripped: boolean; requestCount: number; failureCount: number }> => {
  const key = keyFor(params.experimentId, params.variantId);
  const counter = counters.get(key) ?? { requestCount: 0, failureCount: 0, tripped: false };
  if (!counter.tripped) {
    counter.requestCount += 1;
    if (!params.success) counter.failureCount += 1;
    const minRequests = params.minRequests ?? await readThresholdSetting('ai_experiment_circuit_breaker_min_requests', DEFAULT_MIN_REQUESTS);
    const threshold = params.failureRateThreshold ?? await readThresholdSetting('ai_experiment_circuit_breaker_failure_rate_threshold', DEFAULT_FAILURE_RATE_THRESHOLD);
    if (counter.requestCount >= minRequests && counter.failureCount / counter.requestCount > threshold) {
      counter.tripped = true;
      await reassignAiExperimentVariantToControl({
        experimentId: params.experimentId,
        variantId: params.variantId,
        controlVariantId: params.controlVariantId,
      });
      logError('[ai-experiments] variant auto-paused by circuit breaker', {
        experimentId: params.experimentId,
        variantId: params.variantId,
        requestCount: counter.requestCount,
        failureCount: counter.failureCount,
      });
    }
  }
  counters.set(key, counter);
  return { tripped: counter.tripped, requestCount: counter.requestCount, failureCount: counter.failureCount };
};

export const isExperimentVariantTripped = (experimentId: string, variantId: string): boolean =>
  counters.get(keyFor(experimentId, variantId))?.tripped === true;

export const clearExperimentCircuitBreakerForTests = (): void => {
  counters.clear();
};
