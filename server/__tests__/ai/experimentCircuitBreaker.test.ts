/// <reference types="jest" />

import {
  clearExperimentCircuitBreakerForTests,
  isExperimentVariantTripped,
  recordExperimentVariantOutcome,
} from '../../src/ai/experiments/circuitBreaker';
import { reassignAiExperimentVariantToControl } from '../../src/db';

jest.mock('../../src/db', () => ({
  reassignAiExperimentVariantToControl: jest.fn(async () => 3),
}));

jest.mock('../../src/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

describe('experiment circuit breaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearExperimentCircuitBreakerForTests();
  });

  it('auto-pauses a failing variant and reassigns it to control', async () => {
    for (let index = 0; index < 19; index += 1) {
      await recordExperimentVariantOutcome({
        experimentId: 'exp-1',
        variantId: 'llm',
        controlVariantId: 'control',
        success: index > 9,
        minRequests: 20,
        failureRateThreshold: 0.25,
      });
    }

    expect(isExperimentVariantTripped('exp-1', 'llm')).toBe(false);

    const result = await recordExperimentVariantOutcome({
      experimentId: 'exp-1',
      variantId: 'llm',
      controlVariantId: 'control',
      success: false,
      minRequests: 20,
      failureRateThreshold: 0.25,
    });

    expect(result.tripped).toBe(true);
    expect(reassignAiExperimentVariantToControl).toHaveBeenCalledWith({
      experimentId: 'exp-1',
      variantId: 'llm',
      controlVariantId: 'control',
    });
  });
});
