/// <reference types="jest" />

import {
  computeRecommendationValue,
  confidenceFromSampleSize,
} from '../../src/ai/recommendations/computeRecommendationValue';

describe('recommendation value scoring', () => {
  it('rewards quality and penalizes cost relative to current spend', () => {
    const betterQualitySameCost = computeRecommendationValue({
      qualityScore: 90,
      projectedMonthlyCost: 100,
      currentMonthlyCost: 100,
      sampleSize: 250,
    });
    const worseQualityHigherCost = computeRecommendationValue({
      qualityScore: 70,
      projectedMonthlyCost: 150,
      currentMonthlyCost: 100,
      sampleSize: 250,
    });

    expect(betterQualitySameCost).toBeGreaterThan(worseQualityHigherCost);
  });

  it('derives confidence from sample size', () => {
    expect(confidenceFromSampleSize(20)).toBe('low');
    expect(confidenceFromSampleSize(200)).toBe('medium');
    expect(confidenceFromSampleSize(500)).toBe('high');
  });
});
