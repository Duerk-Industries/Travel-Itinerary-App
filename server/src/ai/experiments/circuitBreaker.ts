import { reassignAiExperimentVariantToControl } from '../../db';
import { logError } from '../../logger';

type Counter = { requestCount: number; failureCount: number; tripped: boolean };
const counters = new Map<string, Counter>();

const keyFor = (experimentId: string, variantId: string) => `${experimentId}:${variantId}`;

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
    const minRequests = params.minRequests ?? 20;
    const threshold = params.failureRateThreshold ?? 0.25;
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
