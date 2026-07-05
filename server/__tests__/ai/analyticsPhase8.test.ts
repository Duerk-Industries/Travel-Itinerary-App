/// <reference types="jest" />
/// <reference types="node" />

import { runAiDailyAggregation } from '../../src/ai/analytics/aggregationJob';
import { detectAiMetricRegressions } from '../../src/ai/analytics/regressionDetector';
import { listAiAnalyticsMetrics, upsertAiAnalyticsMetric } from '../../src/db';
import { readLocalAiCaptureRecordsForDay } from '../../src/ai/analytics/captureBrowser';
import type { AiAnalyticsMetric } from '../../src/types';

jest.mock('../../src/ai/analytics/captureBrowser', () => ({
  readLocalAiCaptureRecordsForDay: jest.fn(),
}));

jest.mock('../../src/db', () => ({
  upsertAiAnalyticsMetric: jest.fn(async (metric) => ({ ...metric, updatedAt: '2026-07-04T00:00:00.000Z' })),
  listAiAnalyticsMetrics: jest.fn(async () => []),
}));

jest.mock('../../src/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockedReadCaptures = readLocalAiCaptureRecordsForDay as jest.MockedFunction<typeof readLocalAiCaptureRecordsForDay>;
const mockedUpsert = upsertAiAnalyticsMetric as jest.MockedFunction<typeof upsertAiAnalyticsMetric>;
const mockedListMetrics = listAiAnalyticsMetrics as jest.MockedFunction<typeof listAiAnalyticsMetrics>;

describe('Phase 8 AI analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListMetrics.mockResolvedValue([]);
  });

  it('rolls captured parsing records into daily metric tables', async () => {
    mockedReadCaptures.mockResolvedValue([
      {
        captureSchemaVersion: 1,
        captureId: 'capture-1',
        featureKey: 'parsing',
        capturedAt: '2026-07-04T12:00:00.000Z',
        correlationId: 'corr-1',
        jobId: 'job-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        callerId: 'LlmExtractor',
        outcome: 'success',
        payload: {
          strategyName: 'LlmExtractor',
          estimatedCostUsd: 0.01,
          parsedItems: [
            {
              itemType: 'hotel',
              extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-01' },
            },
          ],
        },
      },
    ]);

    const result = await runAiDailyAggregation({ day: '2026-07-04', jobId: 'job-test' });

    expect(result.recordsProcessed).toBe(1);
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      table: 'ai_daily_metrics',
      dimensions: { featureKey: 'parsing' },
      metricKey: 'captures_total',
      metricValue: 1,
    }));
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      table: 'ai_field_metrics',
      dimensions: { itemType: 'hotel', fieldName: 'checkInDate' },
      metricKey: 'extracted_total',
      metricValue: 1,
    }));
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      table: 'ai_cost_metrics',
      dimensions: { provider: 'openai', model: 'gpt-4o-mini' },
      metricKey: 'estimated_cost_usd',
      metricValue: 0.01,
    }));
  });

  it('flags metric changes that exceed the configured threshold', () => {
    const current: AiAnalyticsMetric = {
      table: 'ai_daily_metrics',
      periodStart: '2026-07-04',
      periodType: 'day',
      dimensions: { featureKey: 'parsing' },
      metricKey: 'outcome_failure_total',
      metricValue: 15,
      updatedAt: '2026-07-04T00:00:00.000Z',
    };
    const baseline: AiAnalyticsMetric = {
      ...current,
      periodStart: '2026-07-03',
      metricValue: 10,
    };

    const regressions = detectAiMetricRegressions({
      current: [current],
      baseline: [baseline],
      alertThresholdPercent: 25,
      jobId: 'job-test',
    });

    expect(regressions).toHaveLength(1);
    expect(regressions[0].percentChange).toBe(50);
  });
});
