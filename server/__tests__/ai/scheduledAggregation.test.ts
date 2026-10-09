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
  tryAcquireJobLease: jest.fn(async (name: string, holder: string) => ({ name, holder, expiresAt: '2999-01-01T00:00:00.000Z', cursor: null })),
  setJobLeaseCursor: jest.fn(async () => true),
  releaseJobLease: jest.fn(async () => undefined),
  listAiRecommendations: jest.fn(async () => []),
  updateAiRecommendationStatus: jest.fn(),
  listAiExperiments: jest.fn(async () => []),
  updateAiExperimentStatus: jest.fn(),
  deleteCompletedAiExperimentAssignmentsOlderThan: jest.fn(async () => 0),
  listAiAbTestMetrics: jest.fn(async () => []),
  upsertAiRecommendation: jest.fn(),
  listAiAnalyticsMetrics: jest.fn(async () => []),
  updateAiRecommendationOutcome: jest.fn(),
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

describe('scheduled AI analytics aggregation: lease and cursor', () => {
  const db = require('../../src/db') as { tryAcquireJobLease: jest.Mock; setJobLeaseCursor: jest.Mock; releaseJobLease: jest.Mock };
  const { daysToAggregate, MAX_CATCH_UP_DAYS } = require('../../src/ai/analytics/scheduledAggregation') as typeof import('../../src/ai/analytics/scheduledAggregation');

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunAiDailyAggregation.mockImplementation(async (params: any) => ({ ...params, recordsProcessed: 0, metrics: [] }));
  });

  it('computes catch-up days from the cursor, oldest first and bounded', () => {
    expect(daysToAggregate(null, '2026-07-05')).toEqual(['2026-07-05']);
    expect(daysToAggregate('2026-07-05', '2026-07-05')).toEqual([]);
    expect(daysToAggregate('2026-07-02', '2026-07-05')).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
    expect(daysToAggregate('2026-06-28', '2026-07-02')).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
    expect(daysToAggregate('2026-01-01', '2026-07-05')).toHaveLength(MAX_CATCH_UP_DAYS);
    expect(daysToAggregate('garbage', '2026-07-05')).toEqual(['2026-07-05']);
  });

  it('catches up missed days and advances the cursor after each one', async () => {
    db.tryAcquireJobLease.mockResolvedValueOnce({ name: 'ai_daily_aggregation', holder: 'me', expiresAt: '2999-01-01T00:00:00.000Z', cursor: '2026-07-02' });
    const result = await runScheduledAggregationTick({ now: new Date('2026-07-06T03:00:00.000Z') });
    expect(mockedRunAiDailyAggregation.mock.calls.map(([p]: any[]) => p.day)).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
    expect(db.setJobLeaseCursor.mock.calls.map((c: any[]) => c[2])).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
    expect(result).toMatchObject({ day: '2026-07-05', daysProcessed: ['2026-07-03', '2026-07-04', '2026-07-05'] });
    expect(db.releaseJobLease).toHaveBeenCalledTimes(1);
  });

  it('stops at a failed day without advancing the cursor past it', async () => {
    db.tryAcquireJobLease.mockResolvedValueOnce({ name: 'ai_daily_aggregation', holder: 'me', expiresAt: '2999-01-01T00:00:00.000Z', cursor: '2026-07-03' });
    mockedRunAiDailyAggregation
      .mockResolvedValueOnce({ day: '2026-07-04', jobId: 'x', recordsProcessed: 0, metrics: [], error: 'capture_read_failed' } as any);
    await runScheduledAggregationTick({ now: new Date('2026-07-06T03:00:00.000Z') });
    expect(mockedRunAiDailyAggregation).toHaveBeenCalledTimes(1);
    expect(db.setJobLeaseCursor).not.toHaveBeenCalled();
  });

  it('skips the run when another replica holds the lease', async () => {
    db.tryAcquireJobLease.mockResolvedValueOnce(null);
    const result = await runScheduledAggregationTick({ now: new Date('2026-07-06T03:00:00.000Z') });
    expect(result).toMatchObject({ skipped: 'lease_held' });
    expect(mockedRunAiDailyAggregation).not.toHaveBeenCalled();
    expect(db.releaseJobLease).not.toHaveBeenCalled();
  });
});
