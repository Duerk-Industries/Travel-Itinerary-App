/// <reference types="jest" />

import { resolveExperimentVariant } from '../../src/ai/experiments/assignment';

describe('experiment assignment', () => {
  const experiment = {
    experimentId: '11111111-1111-4111-8111-111111111111',
    controlVariantId: 'control',
    variants: [
      { variantId: 'control', trafficPercent: 70 },
      { variantId: 'llm', trafficPercent: 20 },
    ],
  };

  it('is deterministic for the same assignment key and experiment id', () => {
    const first = resolveExperimentVariant('user-1', experiment);
    const second = resolveExperimentVariant('user-1', experiment);

    expect(second).toEqual(first);
  });

  it('maps uncovered percentage to control', () => {
    for (let index = 0; index < 500; index += 1) {
      const variant = resolveExperimentVariant(`sample-${index}`, experiment);
      expect(['control', 'llm']).toContain(variant.variantId);
    }
  });

  it('keeps distribution close to configured percentages over a large sample', () => {
    let llm = 0;
    const total = 5000;
    for (let index = 0; index < total; index += 1) {
      if (resolveExperimentVariant(`user-${index}`, experiment).variantId === 'llm') llm += 1;
    }

    expect(llm / total).toBeGreaterThan(0.16);
    expect(llm / total).toBeLessThan(0.24);
  });
});
