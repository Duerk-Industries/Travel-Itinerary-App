/// <reference types="jest" />
/// <reference types="node" />

import {
  computeDelayToNextRunHourUtc,
  getConfiguredAiAggregationRunHourUtc,
  normalizeRunHourUtc,
  runScheduledAggregationTick,
} from '../../src/ai/analytics/scheduledAggregation';
import { getAdminSetting } from '../../src/db';
import { runAiDailyAggregation } from '../../src/ai/analytics/aggregationJob';

jest.mock('../../src/db', () => ({
  getAdminSetting: jest.fn(),
  listAiRecommendations: jest.fn(async () => []),
  updateAiRecommendationStatus: jest.fn(),
}));

jest.mock('../../src/ai/analytics/aggregationJob', () => ({
  runAiDailyAggregation: jest.fn(async (params) => ({
    ...params,
    recordsProcessed: 0,
    metrics: [],
  })),
}));

jest.mock('../../src/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const mockedGetAdminSetting = getAdminSetting as jest.MockedFunction<typeof getAdminSetting>;
const mockedRunAiDailyAggregation = runAiDailyAggregation as jest.MockedFunction<typeof runAiDailyAggregation>;
const mockedLogger = require('../../src/logger') as { logError: jest.Mock; logInfo: jest.Mock };

describe('scheduled AI analytics aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAdminSetting.mockResolvedValue(null);
    mockedRunAiDailyAggregation.mockResolvedValue({
      jobId: 'scheduled-ai-analytics-2026-07-05',
      day: '2026-07-05',
      recordsProcessed: 0,
      metrics: [],
    } as any);
  });

  it('normalizes invalid configured run hours to the default', () => {
    expect(normalizeRunHourUtc(0)).toBe(0);
    expect(normalizeRunHourUtc(23)).toBe(23);
    expect(normalizeRunHourUtc('9')).toBe(9);
    expect(normalizeRunHourUtc(24)).toBe(3);
    expect(normalizeRunHourUtc(-1)).toBe(3);
    expect(normalizeRunHourUtc('3.5')).toBe(3);
    expect(normalizeRunHourUtc('not-a-number')).toBe(3);
  });

  it('computes delay to the next configured UTC run hour without drifting past today unnecessarily', () => {
    expect(computeDelayToNextRunHourUtc(new Date('2026-07-06T02:30:00.000Z'), 3)).toBe(30 * 60 * 1000);
    expect(computeDelayToNextRunHourUtc(new Date('2026-07-06T03:00:00.000Z'), 3)).toBe(24 * 60 * 60 * 1000);
    expect(computeDelayToNextRunHourUtc(new Date('2026-07-06T04:15:00.000Z'), 3)).toBe((22 * 60 + 45) * 60 * 1000);
  });

  it('reads ai_aggregation_run_hour_utc from admin settings with a default fallback', async () => {
    mockedGetAdminSetting.mockResolvedValueOnce({
      key: 'ai_aggregation_run_hour_utc',
      value: '11',
      updatedBy: null,
      updatedAt: '2026-07-06T00:00:00.000Z',
    });

    await expect(getConfiguredAiAggregationRunHourUtc()).resolves.toBe(11);

    mockedGetAdminSetting.mockResolvedValueOnce({
      key: 'ai_aggregation_run_hour_utc',
      value: '99',
      updatedBy: null,
      updatedAt: '2026-07-06T00:00:00.000Z',
    });

    await expect(getConfiguredAiAggregationRunHourUtc()).resolves.toBe(3);
  });

  it('forced ticks invoke daily aggregation for the previous UTC day', async () => {
    await runScheduledAggregationTick({ now: new Date('2026-07-06T03:00:00.000Z') });

    expect(mockedRunAiDailyAggregation).toHaveBeenCalledWith({
      day: '2026-07-05',
      jobId: 'scheduled-ai-analytics-2026-07-05',
    });
  });

  it('logs a failed tick and allows a later forced tick to run', async () => {
    mockedRunAiDailyAggregation
      .mockRejectedValueOnce(new Error('aggregation failed'))
      .mockResolvedValueOnce({
        jobId: 'scheduled-ai-analytics-2026-07-06',
        day: '2026-07-06',
        recordsProcessed: 0,
        metrics: [],
      } as any);

    await expect(runScheduledAggregationTick({ now: new Date('2026-07-06T03:00:00.000Z') }))
      .resolves.toMatchObject({ error: 'scheduled_aggregation_failed' });
    await runScheduledAggregationTick({ now: new Date('2026-07-07T03:00:00.000Z') });

    expect(mockedRunAiDailyAggregation).toHaveBeenCalledTimes(2);
    expect(mockedLogger.logError).toHaveBeenCalledWith(
      '[ai-analytics] scheduled aggregation failed',
      expect.any(Error)
    );
  });
});
