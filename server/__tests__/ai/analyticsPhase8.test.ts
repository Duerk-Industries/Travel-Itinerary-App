/// <reference types="jest" />
/// <reference types="node" />

import { runAiDailyAggregation } from '../../src/ai/analytics/aggregationJob';
import * as regressionDetectorModule from '../../src/ai/analytics/regressionDetector';
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

const mockedLogger = require('../../src/logger') as { logError: jest.Mock; logInfo: jest.Mock };

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

  it('sources the regression alert threshold from api-limits.yaml instead of a hardcoded default', async () => {
    const spy = jest.spyOn(regressionDetectorModule, 'detectAiMetricRegressions');
    mockedReadCaptures.mockResolvedValue([]);

    await runAiDailyAggregation({ day: '2026-07-04', jobId: 'job-test' });

    // config/api-limits.yaml's budgeting.OPENAI.alertThresholdPercent is 80 —
    // if this ever falls back to regressionDetector's hardcoded default (25),
    // that means the config wiring broke.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ alertThresholdPercent: 80 }));
    spy.mockRestore();
  });

  it('logs and returns an error result when capture reads fail', async () => {
    mockedReadCaptures.mockRejectedValueOnce(new Error('archive unavailable'));

    await expect(runAiDailyAggregation({ day: '2026-07-04', jobId: 'job-test' })).resolves.toMatchObject({
      jobId: 'job-test',
      day: '2026-07-04',
      recordsProcessed: 0,
      metrics: [],
      error: 'capture_read_failed',
    });
    expect(mockedLogger.logError).toHaveBeenCalledWith(
      '[ai-analytics] capture read failed',
      expect.objectContaining({ jobId: 'job-test', day: '2026-07-04', error: 'archive unavailable' })
    );
  });

  it('logs and returns an error result when metric persistence fails', async () => {
    mockedReadCaptures.mockResolvedValue([
      {
        captureSchemaVersion: 1,
        captureId: 'capture-1',
        featureKey: 'parsing',
        capturedAt: '2026-07-04T12:00:00.000Z',
        outcome: 'success',
        payload: {},
      } as any,
    ]);
    mockedUpsert.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(runAiDailyAggregation({ day: '2026-07-04', jobId: 'job-test' })).resolves.toMatchObject({
      jobId: 'job-test',
      day: '2026-07-04',
      recordsProcessed: 1,
      metrics: [],
      error: 'aggregation_write_failed',
    });
    expect(mockedLogger.logError).toHaveBeenCalledWith(
      '[ai-analytics] aggregation write failed',
      expect.objectContaining({ jobId: 'job-test', day: '2026-07-04', error: 'db unavailable' })
    );
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
