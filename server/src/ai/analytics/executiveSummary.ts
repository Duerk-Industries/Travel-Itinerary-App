import { listAiAbTestMetrics, listAiAnalyticsMetrics, listAiRecommendations } from '../../db';

export const getAiExecutiveSummary = async (range: '30d' | '90d' | '180d' = '30d') => {
  const [analytics, abMetrics, recommendations] = await Promise.all([
    listAiAnalyticsMetrics({ limit: 1000 }),
    listAiAbTestMetrics({ limit: 1000 }),
    listAiRecommendations({ limit: 500 }),
  ]);
  const spend = analytics
    .filter((metric) => metric.table === 'ai_cost_metrics' && metric.metricKey === 'estimated_cost_usd')
    .reduce((sum, metric) => sum + metric.metricValue, 0);
  const captures = analytics
    .filter((metric) => metric.table === 'ai_daily_metrics' && metric.metricKey === 'captures_total')
    .reduce((sum, metric) => sum + metric.metricValue, 0);
  const providerMix = analytics
    .filter((metric) => metric.table === 'ai_provider_metrics' && metric.metricKey === 'captures_total')
    .map((metric) => ({ provider: metric.dimensions.provider ?? 'unknown', model: metric.dimensions.model ?? 'unknown', count: metric.metricValue }));
  const recommendationTrackRecord = recommendations.reduce<Record<string, number>>((acc, recommendation) => {
    acc[recommendation.status] = (acc[recommendation.status] ?? 0) + 1;
    return acc;
  }, {});
  const avgExperimentQuality = abMetrics.length
    ? abMetrics.reduce((sum, metric) => sum + metric.avgQualityScore, 0) / abMetrics.length
    : 0;
  return {
    range,
    spend: { estimatedUsd: spend },
    quality: { avgExperimentQuality },
    throughput: { captures },
    providerMix,
    recommendationTrackRecord,
    generatedAt: new Date().toISOString(),
  };
};
