import { getAdminSetting } from '../../db';
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

export const runScheduledAggregationTick = async (params: { now?: Date } = {}) => {
  const day = new Date((params.now ?? new Date()).getTime() - MS_PER_DAY).toISOString().slice(0, 10);
  try {
    const result = await runAiDailyAggregation({ day, jobId: `scheduled-ai-analytics-${day}` });
    await completeExpiredRunningExperiments(params.now);
    await cleanupExpiredExperimentAssignments(params.now);
    await generateAiRecommendationsFromExperimentMetrics();
    await expireStaleRecommendations();
    await measureAppliedRecommendationOutcomes(14, params.now ?? new Date());
    return result;
  } catch (err) {
    logError('[ai-analytics] scheduled aggregation failed', err);
    return { jobId: `scheduled-ai-analytics-${day}`, day, recordsProcessed: 0, metrics: [], error: 'scheduled_aggregation_failed' };
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
