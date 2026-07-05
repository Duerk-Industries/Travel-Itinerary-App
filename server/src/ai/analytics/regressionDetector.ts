import { logError } from '../../logger';
import type { AiAnalyticsMetric } from '../../types';

const metricIdentity = (metric: AiAnalyticsMetric): string =>
  JSON.stringify({
    table: metric.table,
    periodType: metric.periodType,
    dimensions: metric.dimensions,
    metricKey: metric.metricKey,
  });

export const detectAiMetricRegressions = (params: {
  current: AiAnalyticsMetric[];
  baseline: AiAnalyticsMetric[];
  alertThresholdPercent?: number;
  jobId?: string;
}): Array<{ metric: AiAnalyticsMetric; baselineValue: number; percentChange: number }> => {
  const threshold = Math.max(1, params.alertThresholdPercent ?? 25);
  const currentPeriods = new Set(params.current.map((metric) => `${metricIdentity(metric)}|${metric.periodStart}`));
  const baselineById = new Map<string, AiAnalyticsMetric[]>();
  for (const metric of params.baseline) {
    if (currentPeriods.has(`${metricIdentity(metric)}|${metric.periodStart}`)) continue;
    const bucket = baselineById.get(metricIdentity(metric)) ?? [];
    bucket.push(metric);
    baselineById.set(metricIdentity(metric), bucket);
  }

  const regressions: Array<{ metric: AiAnalyticsMetric; baselineValue: number; percentChange: number }> = [];
  for (const metric of params.current) {
    const baselineRows = baselineById.get(metricIdentity(metric)) ?? [];
    if (!baselineRows.length) continue;
    const baselineValue = baselineRows.reduce((sum, row) => sum + row.metricValue, 0) / baselineRows.length;
    if (baselineValue === 0) continue;
    const percentChange = ((metric.metricValue - baselineValue) / baselineValue) * 100;
    if (Math.abs(percentChange) < threshold) continue;
    regressions.push({ metric, baselineValue, percentChange });
    logError('[ai-analytics][regression] metric threshold exceeded', {
      jobId: params.jobId,
      table: metric.table,
      periodStart: metric.periodStart,
      periodType: metric.periodType,
      featureKey: metric.dimensions.featureKey,
      provider: metric.dimensions.provider,
      model: metric.dimensions.model,
      outcome: metric.metricKey,
      metricKey: metric.metricKey,
      currentValue: metric.metricValue,
      baselineValue,
      percentChange,
      alertThresholdPercent: threshold,
    });
  }
  return regressions;
};
