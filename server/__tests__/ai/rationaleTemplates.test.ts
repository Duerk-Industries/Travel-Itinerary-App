/// <reference types="jest" />

import fs from 'fs';
import path from 'path';
import { listRecommendationTypes, renderRecommendationRationale } from '../../src/ai/recommendations/rationaleTemplates';

describe('recommendation rationale templates', () => {
  it('renders every recommendation type without an LLM call', () => {
    for (const type of listRecommendationTypes()) {
      expect(renderRecommendationRationale(type, {
        proposedProvider: 'anthropic',
        qualityDelta: 4,
        costDeltaUsdMonthly: -12,
        confidence: 'medium',
      })).toEqual(expect.any(String));
    }
  });

  it('does not import AI providers, capture, or cost recording modules', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/ai/recommendations/rationaleTemplates.ts'), 'utf8');
    expect(source).not.toMatch(/aiProviderRegistry|captureAiInteraction|recordApiCost/);
  });
});
