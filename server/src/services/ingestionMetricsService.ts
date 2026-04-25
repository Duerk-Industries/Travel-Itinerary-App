import { countImportJobsByState } from '../ingestion/shared/repository';
import { recordGauge } from '../metrics';
import { logError, logInfo } from '../logger';
import { getEnvFlag, getEnvValue } from '../env';

const DEFAULT_TICK_MS = 60_000;

/**
 * Emit one set of ingestion queue-depth gauges. Reads the state-grouped
 * row count from `import_jobs` and calls `recordGauge` for each state +
 * two headline gauges (`ingestion_dead_letter_depth` and
 * `ingestion_pending_depth`) that Ops dashboards typically care about.
 *
 * Exposed separately from the scheduler so tests can exercise it directly.
 */
export const runIngestionMetricsTick = async (): Promise<Record<string, number>> => {
  try {
    const counts = await countImportJobsByState();
    for (const [state, count] of Object.entries(counts)) {
      recordGauge('ingestion_jobs_by_state', count, { state });
    }
    recordGauge('ingestion_dead_letter_depth', counts.DEAD_LETTERED ?? 0);
    recordGauge('ingestion_pending_depth', counts.PENDING ?? 0);
    return counts;
  } catch (err) {
    logError('[ingestion-metrics] tick failed', err);
    return {};
  }
};

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process ingestion metrics scheduler. Defaults to a 60s tick;
 * override with `INGESTION_METRICS_TICK_MS` (floor 10_000). Gated by
 * `INGESTION_METRICS_ENABLED` (default on) + `NODE_ENV !== 'test'`.
 */
export const startIngestionMetricsScheduler = (): boolean => {
  if (schedulerHandle) return false;
  if (!getEnvFlag('INGESTION_METRICS_ENABLED', { defaultValue: true })) {
    logInfo('[ingestion-metrics] scheduler disabled by INGESTION_METRICS_ENABLED=false');
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const raw = getEnvValue('INGESTION_METRICS_TICK_MS');
  const intervalMs = raw && Number.isFinite(Number(raw))
    ? Math.max(10_000, Number(raw))
    : DEFAULT_TICK_MS;
  logInfo(`[ingestion-metrics] starting scheduler (tick=${intervalMs}ms)`);
  schedulerHandle = setInterval(() => {
    runIngestionMetricsTick().catch((err) => logError('[ingestion-metrics] tick error', err));
  }, intervalMs);
  schedulerHandle.unref();
  return true;
};

export const stopIngestionMetricsScheduler = (): void => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
};
