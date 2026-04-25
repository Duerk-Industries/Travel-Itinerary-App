import {
  INGESTION_RETENTION_DEAD_LETTER_DAYS,
  RETENTION_TICK_INTERVAL_MS_DEFAULT,
} from '../ingestion/config';
import {
  deletePayloadsForDeadLetteredJobsOlderThan,
  tombstoneNormalizedTextForTerminalJobsOlderThan,
} from '../ingestion/shared/repository';
import { writeAuditLog } from '../db';
import { logError, logInfo } from '../logger';
import { getEnvFlag, getEnvValue } from '../env';

export interface RetentionTickResult {
  /** Raw ISO cutoff used for this tick — any terminal row stamped before this is eligible for cleanup. */
  cutoffIso: string;
  /** Number of `import_job_payloads` rows removed for DEAD_LETTERED jobs past the retention window. */
  deadLetterPayloadsDeleted: number;
  /** Number of `ingested_documents` rows whose normalized_text/html was tombstoned. */
  normalizedTextTombstoned: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run one retention tick. Deletes raw `import_job_payloads` rows for
 * `import_jobs` that reached terminal `DEAD_LETTERED` state more than
 * `INGESTION_RETENTION_DEAD_LETTER_DAYS` ago. Structured as a list of
 * independent steps so future retention rules (e.g. export-log TTL,
 * orphaned ingested_documents) can be appended without reshaping this
 * function's contract.
 *
 * Errors in one step do not abort the tick — they are logged and the
 * result still reports what succeeded.
 */
export const runRetentionTick = async (opts: { now?: Date; retentionDays?: number } = {}): Promise<RetentionTickResult> => {
  const now = opts.now ?? new Date();
  const days = Math.max(1, Math.floor(opts.retentionDays ?? INGESTION_RETENTION_DEAD_LETTER_DAYS));
  const cutoffIso = new Date(now.getTime() - days * DAY_MS).toISOString();

  let deadLetterPayloadsDeleted = 0;
  try {
    deadLetterPayloadsDeleted = await deletePayloadsForDeadLetteredJobsOlderThan(cutoffIso);
    if (deadLetterPayloadsDeleted > 0) {
      logInfo(`[retention] removed ${deadLetterPayloadsDeleted} dead-lettered import_job_payloads older than ${cutoffIso}`);
    }
  } catch (err) {
    logError('[retention] dead-letter payload sweep failed', err);
  }

  let normalizedTextTombstoned = 0;
  try {
    normalizedTextTombstoned = await tombstoneNormalizedTextForTerminalJobsOlderThan(cutoffIso);
    if (normalizedTextTombstoned > 0) {
      logInfo(`[retention] tombstoned ${normalizedTextTombstoned} ingested_documents.normalized_text older than ${cutoffIso}`);
    }
  } catch (err) {
    logError('[retention] normalized-text tombstone sweep failed', err);
  }

  // Persist an audit entry for every tick so admins can see the scheduler
  // running (including no-op ticks — they confirm the sweep is alive and
  // cut off at the expected window).
  try {
    await writeAuditLog({
      actorUserId: null,
      targetUserId: null,
      action: 'RETENTION_TICK_RUN',
      beforeState: null,
      afterState: {
        cutoffIso,
        retentionDays: days,
        deadLetterPayloadsDeleted,
        normalizedTextTombstoned,
      },
      reason: null,
    });
  } catch (err) {
    logError('[retention] audit log write failed', err);
  }

  return { cutoffIso, deadLetterPayloadsDeleted, normalizedTextTombstoned };
};

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process retention scheduler unless disabled via env. Fires on
 * a fixed interval (default 24h) and calls `runRetentionTick`. Idempotent;
 * returns `true` if the scheduler started during this call, `false` if it
 * was already running or was skipped by env configuration.
 */
export const startRetentionScheduler = (): boolean => {
  if (schedulerHandle) return false;
  if (!getEnvFlag('INGESTION_RETENTION_ENABLED', { defaultValue: true })) {
    logInfo('[retention] scheduler disabled by INGESTION_RETENTION_ENABLED=false');
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const intervalMsRaw = getEnvValue('INGESTION_RETENTION_TICK_MS');
  const intervalMs = intervalMsRaw && Number.isFinite(Number(intervalMsRaw))
    ? Math.max(60_000, Number(intervalMsRaw))
    : RETENTION_TICK_INTERVAL_MS_DEFAULT;
  logInfo(`[retention] starting scheduler (tick=${intervalMs}ms, days=${INGESTION_RETENTION_DEAD_LETTER_DAYS})`);
  schedulerHandle = setInterval(() => {
    runRetentionTick().catch((err) => logError('[retention] tick error', err));
  }, intervalMs);
  schedulerHandle.unref();
  return true;
};

export const stopRetentionScheduler = (): void => {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
};
