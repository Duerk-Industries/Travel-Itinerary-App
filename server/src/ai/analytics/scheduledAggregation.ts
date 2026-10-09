import { getAdminSetting, releaseJobLease, setJobLeaseCursor, tryAcquireJobLease } from '../../db';
import { INSTANCE_ID } from '../../metrics';
import { getEnvFlag } from '../../env';
import { logError, logInfo } from '../../logger';
import { runAiDailyAggregation } from './aggregationJob';
import { cleanupExpiredExperimentAssignments, completeExpiredRunningExperiments } from '../experiments/lifecycle';
import { expireStaleRecommendations, measureAppliedRecommendationOutcomes } from '../recommendations/feedbackLoop';
import { generateAiRecommendationsFromExperimentMetrics } from '../recommendations/recommendationEngine';

export const DEFAULT_AI_AGGREGATION_RUN_HOUR_UTC = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let schedulerHandle: ReturnType<typeof setTimeout> | null = null;

export const normalizeRunHourUtc = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) {
    return DEFAULT_AI_AGGREGATION_RUN_HOUR_UTC;
  }
  return numeric;
};

export const computeDelayToNextRunHourUtc = (
  now: Date,
  runHourUtc: number,
): number => {
  const normalizedHour = normalizeRunHourUtc(runHourUtc);
  const next = new Date(now.getTime());
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(normalizedHour);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
};

export const getConfiguredAiAggregationRunHourUtc = async (): Promise<number> => {
  const setting = await getAdminSetting('ai_aggregation_run_hour_utc');
  return normalizeRunHourUtc(setting?.value);
};

/**
 * Only one replica runs the daily rollup: a durable lease (job_leases) guards the
 * tick, and its cursor records the last day aggregated so a missed or failed day
 * is caught up on the next tick (bounded to MAX_CATCH_UP_DAYS, oldest first).
 */
export const AI_AGGREGATION_LEASE = 'ai_daily_aggregation';
export const MAX_CATCH_UP_DAYS = 7;
const LEASE_TTL_MS = 30 * 60 * 1000;

const addDays = (day: string, days: number): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);

export const daysToAggregate = (cursor: string | null, yesterday: string): string[] => {
  if (!cursor || !/^\d{4}-\d{2}-\d{2}$/.test(cursor)) return [yesterday];
  const days: string[] = [];
  for (let day = addDays(cursor, 1); day <= yesterday; day = addDays(day, 1)) days.push(day);
  return days.slice(-MAX_CATCH_UP_DAYS);
};

export const runScheduledAggregationTick = async (params: { now?: Date } = {}) => {
  const day = new Date((params.now ?? new Date()).getTime() - MS_PER_DAY).toISOString().slice(0, 10);
  const lease = await tryAcquireJobLease(AI_AGGREGATION_LEASE, INSTANCE_ID, LEASE_TTL_MS).catch((err) => {
    logError('[ai-analytics] aggregation lease unavailable', err);
    return null;
  });
  if (!lease) {
    return { jobId: `scheduled-ai-analytics-${day}`, day, recordsProcessed: 0, metrics: [], skipped: 'lease_held' as const };
  }
  try {
    const days = daysToAggregate(lease.cursor, day);
    let result: Awaited<ReturnType<typeof runAiDailyAggregation>> | null = null;
    for (const target of days) {
      result = await runAiDailyAggregation({ day: target, jobId: `scheduled-ai-analytics-${target}` });
      if (result.error) break; // retried from this day on the next tick
      await setJobLeaseCursor(AI_AGGREGATION_LEASE, INSTANCE_ID, target);
    }
    await completeExpiredRunningExperiments(params.now);
    await cleanupExpiredExperimentAssignments(params.now);
    await generateAiRecommendationsFromExperimentMetrics();
    await expireStaleRecommendations();
    await measureAppliedRecommendationOutcomes(14, params.now ?? new Date());
    return result
      ? { ...result, daysProcessed: days }
      : { jobId: `scheduled-ai-analytics-${day}`, day, recordsProcessed: 0, metrics: [], skipped: 'already_aggregated' as const };
  } catch (err) {
    logError('[ai-analytics] scheduled aggregation failed', err);
    return { jobId: `scheduled-ai-analytics-${day}`, day, recordsProcessed: 0, metrics: [], error: 'scheduled_aggregation_failed' };
  } finally {
    await releaseJobLease(AI_AGGREGATION_LEASE, INSTANCE_ID).catch(() => undefined);
  }
};

const scheduleNextTick = async (): Promise<void> => {
  const runHourUtc = await getConfiguredAiAggregationRunHourUtc();
  const delayMs = computeDelayToNextRunHourUtc(new Date(), runHourUtc);
  schedulerHandle = setTimeout(() => {
    runScheduledAggregationTick()
      .catch((err) => logError('[ai-analytics] scheduled aggregation failed', err))
      .finally(() => {
        schedulerHandle = null;
        void scheduleNextTick().catch((err) => logError('[ai-analytics] scheduler reschedule failed', err));
      });
  }, delayMs);
  schedulerHandle.unref?.();
  logInfo(`[ai-analytics] scheduled aggregation nextRunHourUtc=${runHourUtc} delayMs=${delayMs}`);
};

export const startScheduledAggregation = (): boolean => {
  if (schedulerHandle) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (!getEnvFlag('AI_ANALYTICS_AGGREGATION_SCHEDULER_ENABLED', { defaultValue: true })) {
    logInfo('[ai-analytics] scheduled aggregation disabled by AI_ANALYTICS_AGGREGATION_SCHEDULER_ENABLED=false');
    return false;
  }
  void scheduleNextTick().catch((err) => logError('[ai-analytics] scheduler start failed', err));
  return true;
};

export const stopScheduledAggregation = (): void => {
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
  }
};
