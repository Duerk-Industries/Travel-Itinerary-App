import { getBackendUrl, getEnvValue, isLocalEnv } from '../../env';
import { logError, logInfo } from '../../logger';
import { INGESTION_JOB_QUEUE_MODE_DEFAULT } from '../config';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/**
 * True for loopback URLs that a local dev server can safely target with
 * cloud-style enqueue. A missing/empty value also counts as "local" — the
 * cloud queue would throw on first enqueue anyway, and we want the guard
 * to focus on the actual footgun (a real remote URL).
 */
const isLocalLoopbackUrl = (url: string | undefined | null): boolean => {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    return LOCAL_HOSTNAMES.has(host);
  } catch {
    return false;
  }
};

/**
 * Decide the effective queue mode at startup. The configured mode wins
 * unless we detect the classic footgun: running locally (`RUN_LOCAL=1`)
 * with `INGESTION_JOB_QUEUE_MODE=cloud_run` and a non-local
 * `BACKEND_URL` / `INGESTION_WORKER_BASE_URL`. In that case the local
 * dev server would dispatch ingestion work to whatever remote URL is
 * configured — typically production. We force `in_process` and log a
 * loud warning so the misconfiguration is visible without breaking
 * uploads.
 *
 * Exported for unit tests.
 */
export const resolveJobQueueMode = (): 'in_process' | 'cloud_run' => {
  const configured = (
    getEnvValue('INGESTION_JOB_QUEUE_MODE', {
      defaultValue: process.env.NODE_ENV === 'production' ? INGESTION_JOB_QUEUE_MODE_DEFAULT : 'in_process',
    }) || 'in_process'
  )
    .trim()
    .toLowerCase();
  const mode = configured === 'cloud_run' ? 'cloud_run' : 'in_process';
  if (mode !== 'cloud_run' || !isLocalEnv()) return mode;
  const baseUrl = getEnvValue('INGESTION_WORKER_BASE_URL') ?? getBackendUrl();
  if (isLocalLoopbackUrl(baseUrl)) return 'cloud_run';
  logError(
    `[ingestion][queue] refusing cloud_run mode locally — base URL "${baseUrl}" is not a loopback address. ` +
      `Forcing in_process to avoid dispatching local uploads to a remote server. ` +
      `Set INGESTION_JOB_QUEUE_MODE=in_process or INGESTION_WORKER_BASE_URL=http://localhost:<port> in .local_env to silence.`
  );
  return 'in_process';
};

export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
}

class InProcessJobQueue implements JobQueue {
  async enqueue(jobId: string): Promise<void> {
    logInfo(`[ingestion][queue] dispatching in-process job=${jobId}`);
    setTimeout(() => {
      void Promise.resolve()
        .then(() => require('../orchestrator') as typeof import('../orchestrator'))
        .then(({ processImportJob }) => processImportJob(jobId))
        .catch((error) => {
          logError(`[ingestion] in-process worker failed job=${jobId}`, error);
        });
    }, 0);
  }
}

class CloudRunJobQueue implements JobQueue {
  async enqueue(jobId: string): Promise<void> {
    const baseUrl = getEnvValue('INGESTION_WORKER_BASE_URL') ?? getBackendUrl();
    const sharedSecret = getEnvValue('INGESTION_WORKER_SHARED_SECRET', { required: true })!;
    if (!baseUrl) {
      throw new Error('INGESTION_WORKER_BASE_URL or BACKEND_URL must be configured for cloud job queue mode.');
    }
    const url = new URL(`/api/internal/ingestion/jobs/${jobId}/run`, baseUrl).toString();
    logInfo(`[ingestion][queue] dispatching cloud-run job=${jobId} url=${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingestion-Worker-Secret': sharedSecret,
      },
      body: JSON.stringify({ jobId }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = body ? `: ${body.slice(0, 500)}` : '';
      throw new Error(`Cloud worker enqueue failed with HTTP ${response.status}${detail}`);
    }
    logInfo(`[ingestion][queue] accepted cloud-run job=${jobId} status=${response.status}`);
  }
}

let cachedQueue: JobQueue | null = null;

export const getJobQueue = (): JobQueue => {
  if (cachedQueue) return cachedQueue;
  const mode = resolveJobQueueMode();
  logInfo(`[ingestion][queue] initializing mode=${mode}`);
  cachedQueue = mode === 'in_process' ? new InProcessJobQueue() : new CloudRunJobQueue();
  return cachedQueue;
};

export const resetJobQueueForTests = (): void => {
  cachedQueue = null;
};
