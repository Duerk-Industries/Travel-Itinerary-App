import { FAILED_RETRY_SCHEDULER_TICK_INTERVAL_MS_DEFAULT } from '../ingestion/config';
import {
  getRetryPolicyConfig,
  listFailedJobsReadyForRetry,
  requeueImportJob,
} from '../ingestion/shared/repository';
import { getJobQueue } from '../ingestion/worker/jobQueue';
import { logError, logInfo } from '../logger';
import { getEnvFlag, getEnvValue } from '../env';

export interface FailedRetryTickResult {
  /** How many FAILED rows were eligible for retry at this tick. */
  eligible: number;
  /** How many rows were actually requeued (state gate + enqueue both succeeded). */
  retried: number;
  /** Row ids that made it back into the queue — capped at 100 for log size. */
  retriedIds: string[];
}

/**
 * Run one failed-retry tick. Mirrors the HTTP endpoint at
 * `POST /api/internal/ingestion/retries/failed/run` but runs in-process so
 * single-instance deployments don't need an external cron to recover from
 * transient failures.
 */
export const runFailedRetryTick = async (
  opts: { limit?: number } = {},
): Promise<FailedRetryTickResult> => {
  const policy = await getRetryPolicyConfig();
  const ready = await listFailedJobsReadyForRetry({
    maxAttempts: policy.maxAttempts,
    limit: opts.limit,
  });
  const retriedIds: string[] = [];
  const queue = getJobQueue();
  for (const job of ready) {
    const requeued = await requeueImportJob(job.id);
    if (!requeued) continue;
    try {
      await queue.enqueue(job.id);
      retriedIds.push(job.id);
    } catch (err) {
      logError(`[failed-retry] enqueue failed job=${job.id}`, err);
    }
  }
  if (ready.length > 0 || retriedIds.length > 0) {
    logInfo(`[failed-retry] tick — eligible=${ready.length}, retried=${retriedIds.length}`);
  }
  return { eligible: ready.length, retried: retriedIds.length, retriedIds: retriedIds.slice(0, 100) };
};

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process failed-retry scheduler unless disabled via env. Fires
 * on a fixed interval (default 5 minutes) and calls `runFailedRetryTick`.
 * Idempotent; returns `true` if the scheduler started during this call,
 * `false` if it was already running or was skipped by env configuration.
 */
export const startFailedRetryScheduler = (): boolean => {
  if (schedulerHandle) return false;
  if (!getEnvFlag('INGESTION_FAILED_RETRY_ENABLED', { defaultValue: true })) {
    logInfo('[failed-retry] scheduler disabled by INGESTION_FAILED_RETRY_ENABLED=false');
    return false;
  }
  if (process.env.NODE_ENV === 'test') return false;
  const intervalMsRaw = getEnvValue('INGESTION_FAILED_RETRY_TICK_MS');
  const intervalMs = intervalMsRaw && Number.isFinite(Number(intervalMsRaw))
    ? Math.max(60_000, Number(intervalMsRaw))
    : FAILED_RETRY_SCHEDULER_TICK_INTERVAL_MS_DEFAULT;
  logInfo(`[failed-retry] starting scheduler (tick=${intervalMs}ms)`);
  schedulerHandle = setInterval(() => {
    runFailedRetryTick().catch((err) => logError('[failed-retry] tick error', err));
  }, intervalMs);
  schedulerHandle.unref();
  return true;
};

export const stopFailedRetryScheduler = (): void => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
};
