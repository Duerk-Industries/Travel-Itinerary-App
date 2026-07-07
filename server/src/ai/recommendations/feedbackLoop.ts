import { listAiAnalyticsMetrics, listAiRecommendations, updateAiRecommendationOutcome, updateAiRecommendationStatus } from '../../db';
import { logError } from '../../logger';

export const expireStaleRecommendations = async (olderThanDays = 30): Promise<number> => {
  const proposed = await listAiRecommendations({ status: 'proposed', limit: 500 });
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let expired = 0;
  for (const recommendation of proposed) {
    if (new Date(recommendation.createdAt).getTime() >= cutoff) continue;
    try {
      await updateAiRecommendationStatus({
        recommendationId: recommendation.recommendationId,
        status: 'expired',
        respondedBy: null,
      });
      expired += 1;
    } catch (err) {
      logError('[ai-recommendations] failed to expire stale recommendation', err);
    }
  }
  return expired;
};

export const measureAppliedRecommendationOutcomes = async (waitDays = 14, now = new Date()): Promise<number> => {
  const applied = await listAiRecommendations({ status: 'applied', limit: 500 });
  const metrics = await listAiAnalyticsMetrics({ limit: 1000 });
  const costTotal = metrics
    .filter((metric) => metric.table === 'ai_cost_metrics' && metric.metricKey === 'estimated_cost_usd')
    .reduce((sum, metric) => sum + metric.metricValue, 0);
  let measured = 0;
  for (const recommendation of applied) {
    if (recommendation.outcomeMeasuredAt) continue;
    if (!recommendation.respondedAt) continue;
    const eligibleAt = new Date(recommendation.respondedAt).getTime() + waitDays * 24 * 60 * 60 * 1000;
    if (eligibleAt > now.getTime()) continue;
    try {
      await updateAiRecommendationOutcome({
        recommendationId: recommendation.recommendationId,
        outcomeQualityDelta: 0,
        outcomeCostDeltaUsdMonthly: costTotal - recommendation.costDeltaEstimateUsdMonthly,
        measuredAt: now.toISOString(),
      });
      measured += 1;
    } catch (err) {
      logError('[ai-recommendations] failed to measure recommendation outcome', err);
    }
  }
  return measured;
};
