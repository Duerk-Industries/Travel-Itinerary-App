export const RECOMMENDATION_ENGINE_VERSION = 'phase10-v1';

export type RecommendationValueInput = {
  qualityScore: number;
  projectedMonthlyCost: number;
  currentMonthlyCost: number;
  sampleSize: number;
};

export const computeRecommendationValue = (
  variant: RecommendationValueInput,
  weights: { quality: number; cost: number } = { quality: 0.7, cost: 0.3 },
): number => {
  const normalizedQuality = Math.max(0, Math.min(1, variant.qualityScore / 100));
  const normalizedCost = variant.currentMonthlyCost > 0
    ? variant.projectedMonthlyCost / variant.currentMonthlyCost
    : variant.projectedMonthlyCost > 0 ? 1 : 0;
  return weights.quality * normalizedQuality - weights.cost * normalizedCost;
};

export const confidenceFromSampleSize = (sampleSize: number): 'low' | 'medium' | 'high' => {
  if (sampleSize >= 500) return 'high';
  if (sampleSize >= 200) return 'medium';
  return 'low';
};
