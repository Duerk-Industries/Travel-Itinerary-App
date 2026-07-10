import { listAiAnalyticsMetrics, upsertAiAbTestMetric, upsertAiAnalyticsMetric } from '../../db';
import { logError, logInfo } from '../../logger';
import type { AiAnalyticsMetric, AiAnalyticsPeriodType } from '../../types';
import { getApiBudgetProviderConfig } from '../../config/apiLimits';
import type { CaptureRecord } from '../types/captureRecord';
import { readLocalAiCaptureRecordsForDay } from './captureBrowser';
import { detectAiMetricRegressions } from './regressionDetector';

// Reuse the same alertThresholdPercent config surface api-limits.yaml already
// exposes for provider cost budgets, rather than inventing a second,
// disconnected alerting knob just for metric-regression detection. OPENAI is
// the always-present reference provider, so its threshold is the sourced
// default; falls back to regressionDetector's own hardcoded default only if
// that block is ever removed from config.
const getRegressionAlertThresholdPercent = (): number | undefined =>
  getApiBudgetProviderConfig('OPENAI')?.alertThresholdPercent;

const increment = (map: Map<string, number>, key: string, amount = 1): void => {
  map.set(key, (map.get(key) ?? 0) + amount);
};

const metricKey = (...parts: string[]): string => parts.join('\u001f');

type AbMetricAccumulator = {
  requestCount: number;
  successCount: number;
  qualityScoreSum: number;
  qualityScoreCount: number;
  costUsdSum: number;
  latencyMsSum: number;
  latencyCount: number;
  groundTruthAgreementSum: number;
  groundTruthAgreementCount: number;
  groundTruthSignals: Map<string, number>;
};

const numberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getComparisonQualityScore = (payload: Record<string, unknown>): number | null => {
  const comparison = payload.comparison && typeof payload.comparison === 'object'
    ? payload.comparison as Record<string, unknown>
    : null;
  const agreementRate = numberOrNull(comparison?.agreementRate);
  return agreementRate == null ? null : agreementRate * 100;
};

const dominantSignal = (signals: Map<string, number>): string | null => {
  let selected: string | null = null;
  let selectedCount = -1;
  for (const [signal, count] of signals) {
    if (count > selectedCount) {
      selected = signal;
      selectedCount = count;
    }
  }
  return selected;
};

const startOfWeek = (day: string): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
};

const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

const startOfQuarter = (day: string): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  const month = Math.floor(date.getUTCMonth() / 3) * 3;
  return `${date.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}-01`;
};

const rollupStart = (day: string, periodType: AiAnalyticsPeriodType): string => {
  if (periodType === 'week') return startOfWeek(day);
  if (periodType === 'month') return startOfMonth(day);
  if (periodType === 'quarter') return startOfQuarter(day);
  return day;
};

const toMetric = (
  table: AiAnalyticsMetric['table'],
  periodStart: string,
  periodType: AiAnalyticsPeriodType,
  dimensions: Record<string, string>,
  key: string,
  value: number,
): Omit<AiAnalyticsMetric, 'updatedAt'> => ({
  table,
  periodStart,
  periodType,
  dimensions,
  metricKey: key,
  metricValue: value,
});

export const runAiDailyAggregation = async (params: { day?: string; jobId?: string } = {}) => {
  const day = params.day ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const jobId = params.jobId ?? `ai-analytics-${day}`;
  let records: CaptureRecord[] = [];
  try {
    records = await readLocalAiCaptureRecordsForDay(day);
  } catch (err) {
    logError('[ai-analytics] capture read failed', { jobId, day, error: err instanceof Error ? err.message : String(err) });
    return { jobId, day, recordsProcessed: 0, metrics: [], error: 'capture_read_failed' };
  }
  const daily = new Map<string, number>();
  const provider = new Map<string, number>();
  const prompt = new Map<string, number>();
  const parser = new Map<string, number>();
  const field = new Map<string, number>();
  const cost = new Map<string, number>();
  const abMetrics = new Map<string, AbMetricAccumulator>();

  for (const record of records) {
    const providerName = record.provider ?? 'unknown';
    const model = record.model ?? 'unknown';
    const callerId = record.callerId ?? 'unknown';
    increment(daily, metricKey(record.featureKey, 'captures_total'));
    increment(daily, metricKey(record.featureKey, `outcome_${record.outcome}_total`));
    increment(provider, metricKey(providerName, model, 'captures_total'));
    increment(prompt, metricKey(record.featureKey, callerId, 'captures_total'));
    if (record.featureKey === 'parsing') {
      const parserName = String(record.payload.strategyName ?? callerId);
      increment(parser, metricKey(parserName, 'captures_total'));
      const parsedItems = Array.isArray(record.payload.parsedItems) ? record.payload.parsedItems : [];
      increment(parser, metricKey(parserName, 'parsed_items_total'), parsedItems.length);
      for (const item of parsedItems) {
        const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const itemType = String(raw.itemType ?? 'generic_note');
        const fields = raw.extractedFields && typeof raw.extractedFields === 'object'
          ? Object.keys(raw.extractedFields as Record<string, unknown>)
          : [];
        for (const fieldName of fields) increment(field, metricKey(itemType, fieldName, 'extracted_total'));
      }
    }
    const estimatedCostUsd = Number(record.payload.estimatedCostUsd ?? 0);
    if (Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0) {
      increment(cost, metricKey(providerName, model, 'estimated_cost_usd'), estimatedCostUsd);
    }

    const experimentId = typeof record.payload.experimentId === 'string' ? record.payload.experimentId : null;
    const variantId = typeof record.payload.variantId === 'string' ? record.payload.variantId : null;
    if (experimentId && variantId) {
      const key = metricKey(experimentId, variantId, day);
      const current = abMetrics.get(key) ?? {
        requestCount: 0,
        successCount: 0,
        qualityScoreSum: 0,
        qualityScoreCount: 0,
        costUsdSum: 0,
        latencyMsSum: 0,
        latencyCount: 0,
        groundTruthAgreementSum: 0,
        groundTruthAgreementCount: 0,
        groundTruthSignals: new Map<string, number>(),
      };
      current.requestCount += 1;
      if (record.outcome === 'success') current.successCount += 1;
      const qualityScore = numberOrNull(record.payload.qualityScore) ?? getComparisonQualityScore(record.payload);
      if (qualityScore != null) {
        current.qualityScoreSum += qualityScore;
        current.qualityScoreCount += 1;
      }
      if (Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0) current.costUsdSum += estimatedCostUsd;
      const latencyMs = numberOrNull(record.latencyMs);
      if (latencyMs != null) {
        current.latencyMsSum += latencyMs;
        current.latencyCount += 1;
      }
      const groundTruthAgreement = numberOrNull(record.payload.groundTruthAgreement)
        ?? numberOrNull((record.payload.comparison as Record<string, unknown> | undefined)?.agreementRate);
      if (groundTruthAgreement != null) {
        current.groundTruthAgreementSum += groundTruthAgreement;
        current.groundTruthAgreementCount += 1;
      }
      const groundTruthSignal = typeof record.payload.groundTruthSignal === 'string'
        ? record.payload.groundTruthSignal
        : groundTruthAgreement != null ? 'comparison' : 'none';
      current.groundTruthSignals.set(groundTruthSignal, (current.groundTruthSignals.get(groundTruthSignal) ?? 0) + 1);
      abMetrics.set(key, current);
    }
  }

  const metrics: Array<Omit<AiAnalyticsMetric, 'updatedAt'>> = [];
  for (const [key, value] of daily) {
    const [featureKey, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_daily_metrics', day, 'day', { featureKey }, metric, value));
  }
  for (const [key, value] of provider) {
    const [providerName, model, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_provider_metrics', day, 'day', { provider: providerName, model }, metric, value));
  }
  for (const [key, value] of prompt) {
    const [featureKey, callerId, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_prompt_metrics', day, 'day', { featureKey, callerId }, metric, value));
  }
  for (const [key, value] of parser) {
    const [parserName, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_parser_metrics', day, 'day', { parserName }, metric, value));
  }
  for (const [key, value] of field) {
    const [itemType, fieldName, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_field_metrics', day, 'day', { itemType, fieldName }, metric, value));
  }
  for (const [key, value] of cost) {
    const [providerName, model, metric] = key.split('\u001f');
    metrics.push(toMetric('ai_cost_metrics', day, 'day', { provider: providerName, model }, metric, value));
  }

  try {
    const persisted = await Promise.all(metrics.map((metric) => upsertAiAnalyticsMetric(metric)));
    await Promise.all(Array.from(abMetrics.entries()).map(([key, item]) => {
      const [experimentId, variantId, metricDay] = key.split('\u001f');
      return upsertAiAbTestMetric({
        experimentId,
        variantId,
        day: metricDay,
        requestCount: item.requestCount,
        successRate: item.requestCount ? item.successCount / item.requestCount : 0,
        avgQualityScore: item.qualityScoreCount ? item.qualityScoreSum / item.qualityScoreCount : 0,
        avgCostUsd: item.requestCount ? item.costUsdSum / item.requestCount : 0,
        avgLatencyMs: item.latencyCount ? item.latencyMsSum / item.latencyCount : 0,
        groundTruthAgreement: item.groundTruthAgreementCount ? item.groundTruthAgreementSum / item.groundTruthAgreementCount : null,
        groundTruthSignal: dominantSignal(item.groundTruthSignals),
      });
    }));
    await rollupAiAnalytics({ day, jobId });
    const baseline = await listAiAnalyticsMetrics({ periodType: 'day', limit: 500 });
    detectAiMetricRegressions({
      current: persisted,
      baseline,
      jobId,
      alertThresholdPercent: getRegressionAlertThresholdPercent(),
    });
    logInfo(`[ai-analytics] completed jobId=${jobId} day=${day} records=${records.length} metrics=${persisted.length}`);
    return { jobId, day, recordsProcessed: records.length, metrics: persisted };
  } catch (err) {
    logError('[ai-analytics] aggregation write failed', { jobId, day, error: err instanceof Error ? err.message : String(err) });
    return { jobId, day, recordsProcessed: records.length, metrics: [], error: 'aggregation_write_failed' };
  }
};

export const rollupAiAnalytics = async (params: { day: string; jobId?: string }): Promise<void> => {
  const dayMetrics = await listAiAnalyticsMetrics({ periodType: 'day', periodStart: params.day, limit: 1000 });
  for (const periodType of ['week', 'month', 'quarter'] as const) {
    const periodStart = rollupStart(params.day, periodType);
    await Promise.all(dayMetrics.map((metric) => upsertAiAnalyticsMetric({
      table: metric.table,
      periodStart,
      periodType,
      dimensions: metric.dimensions,
      metricKey: metric.metricKey,
      metricValue: metric.metricValue,
    })));
  }
};
