import { listAiAbTestMetrics, listAiRecommendations, updateAiRecommendationOutcome, updateAiRecommendationStatus } from '../../db';
import type { AiAbTestMetric } from '../../types';
import { logError } from '../../logger';

const average = (rows: AiAbTestMetric[], key: 'avgQualityScore' | 'avgCostUsd'): number | null =>
  rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : null;

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
  let measured = 0;
  for (const recommendation of applied) {
    if (recommendation.outcomeMeasuredAt) continue;
    if (!recommendation.respondedAt) continue;
    const respondedAtMs = new Date(recommendation.respondedAt).getTime();
    const eligibleAt = respondedAtMs + waitDays * 24 * 60 * 60 * 1000;
    if (eligibleAt > now.getTime()) continue;

    // Every recommendation this engine currently produces is generated
    // from an experiment (recommendationEngine.ts), so its evidence query
    // always carries experimentId/proposedVariantId — use that to pull the
    // *actual* before/after ai_ab_test_metrics for the specific variant
    // this recommendation was about, rather than a global, unscoped sum
    // across every provider/feature (the previous bug here). A future
    // recommendation_type not tied to an experiment has no equivalent
    // per-feature daily quality signal to diff against yet — report `null`
    // ("not measured") rather than a fabricated `0` ("measured, no change").
    const evidence = recommendation.supportingEvidenceQuery ?? {};
    const experimentId = typeof evidence.experimentId === 'string' ? evidence.experimentId : null;
    const proposedVariantId = typeof evidence.proposedVariantId === 'string' ? evidence.proposedVariantId : null;

    let outcomeQualityDelta: number | null = null;
    let outcomeCostDeltaUsdMonthly: number | null = null;

    if (experimentId && proposedVariantId) {
      const variantMetrics = (await listAiAbTestMetrics({ experimentId, limit: 1000 }))
        .filter((metric) => metric.variantId === proposedVariantId);
      const beforeWindow = variantMetrics.filter((metric) => new Date(metric.day).getTime() < respondedAtMs);
      const afterWindow = variantMetrics.filter((metric) => {
        const dayMs = new Date(metric.day).getTime();
        return dayMs >= respondedAtMs && dayMs <= eligibleAt;
      });

      const beforeQuality = average(beforeWindow, 'avgQualityScore');
      const afterQuality = average(afterWindow, 'avgQualityScore');
      if (beforeQuality != null && afterQuality != null) {
        outcomeQualityDelta = afterQuality - beforeQuality;
      }

      const beforeCost = average(beforeWindow, 'avgCostUsd');
      const afterCost = average(afterWindow, 'avgCostUsd');
      if (beforeCost != null && afterCost != null) {
        // avgCostUsd is per-request; project the per-request delta to a
        // monthly figure using the "after" window's actual request
        // volume as the run-rate, not a static/unrelated total.
        const afterRequestsPerDay = afterWindow.length
          ? afterWindow.reduce((sum, metric) => sum + metric.requestCount, 0) / afterWindow.length
          : 0;
        outcomeCostDeltaUsdMonthly = (afterCost - beforeCost) * afterRequestsPerDay * 30;
      }
    }

    try {
      await updateAiRecommendationOutcome({
        recommendationId: recommendation.recommendationId,
        outcomeQualityDelta,
        outcomeCostDeltaUsdMonthly,
        measuredAt: now.toISOString(),
      });
      measured += 1;
    } catch (err) {
      logError('[ai-recommendations] failed to measure recommendation outcome', err);
    }
  }
  return measured;
};
