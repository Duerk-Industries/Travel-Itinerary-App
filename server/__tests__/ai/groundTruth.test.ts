/// <reference types="jest" />

import { resolveGroundTruthSignal } from '../../src/ai/experiments/groundTruth';

describe('ground truth signal resolution', () => {
  it('prefers admin review over fixture labels', () => {
    expect(resolveGroundTruthSignal({
      adminReview: { agreement: 0.9 },
      goldenFixture: { agreement: 0.2 },
    })).toEqual({ signal: 'admin_review', agreement: 0.9 });
  });

  it('uses fixture labels when no admin review exists', () => {
    expect(resolveGroundTruthSignal({
      goldenFixture: { agreement: 0.8 },
    })).toEqual({ signal: 'golden_fixture', agreement: 0.8 });
  });

  it('returns no signal when no source exists', () => {
    expect(resolveGroundTruthSignal({})).toEqual({ signal: 'none', agreement: null });
  });
});
