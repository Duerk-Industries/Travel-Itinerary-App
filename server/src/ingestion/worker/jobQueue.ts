import { getBackendUrl, getEnvValue } from '../../env';
import { logError, logInfo } from '../../logger';
import { INGESTION_JOB_QUEUE_MODE_DEFAULT } from '../config';

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
      throw new Error(`Cloud worker enqueue failed with HTTP ${response.status}`);
    }
    logInfo(`[ingestion][queue] accepted cloud-run job=${jobId} status=${response.status}`);
  }
}

let cachedQueue: JobQueue | null = null;

export const getJobQueue = (): JobQueue => {
  if (cachedQueue) return cachedQueue;
  const mode = (getEnvValue('INGESTION_JOB_QUEUE_MODE', {
    defaultValue: process.env.NODE_ENV === 'production' ? INGESTION_JOB_QUEUE_MODE_DEFAULT : 'in_process',
  }) || 'in_process')
    .trim()
    .toLowerCase();
  logInfo(`[ingestion][queue] initializing mode=${mode}`);
  cachedQueue = mode === 'in_process' ? new InProcessJobQueue() : new CloudRunJobQueue();
  return cachedQueue;
};

export const resetJobQueueForTests = (): void => {
  cachedQueue = null;
};
