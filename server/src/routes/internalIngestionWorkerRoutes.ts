import { Router } from 'express';
import bodyParser from 'body-parser';
import { getEnvValue } from '../env';
import { processImportJob } from '../ingestion/orchestrator';
import { getRetryPolicyConfig, listDeadLetterImportJobs, listFailedJobsReadyForRetry, requeueImportJob } from '../ingestion/shared/repository';
import { requeueDeadLetterImportJob } from '../ingestion/orchestrator';
import { getJobQueue } from '../ingestion/worker/jobQueue';
import { logError, logInfo } from '../logger';

const router = Router();
router.use(bodyParser.json({ limit: '1mb' }));

const authenticateWorker = (req: any, res: any, next: any) => {
  const configured = getEnvValue('INGESTION_WORKER_SHARED_SECRET');
  if (!configured) {
    logError('[ingestion][worker] rejected request because worker secret is not configured');
    res.status(503).json({ error: 'Worker secret not configured.' });
    return;
  }
  const provided = String(req.header('X-Ingestion-Worker-Secret') ?? '');
  if (!provided || provided !== configured) {
    logError(`[ingestion][worker] rejected request job=${String(req.params?.jobId ?? 'unknown')} due to invalid shared secret`);
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  next();
};

const calculateRetryDelayMs = (retryCount: number, baseDelaySeconds: number, maxDelaySeconds: number): number => {
  const exponential = Math.min(maxDelaySeconds, baseDelaySeconds * Math.max(1, 2 ** Math.max(0, retryCount - 1)));
  const jitter = Math.floor(exponential * 0.2);
  return (exponential + jitter) * 1000;
};

router.post('/jobs/:jobId/run', authenticateWorker, (req, res) => {
  const jobId = String(req.params.jobId);
  logInfo(`[ingestion][worker] accepted job=${jobId}`);
  res.status(202).json({ accepted: true, jobId, mode: 'async-detached' });

  setImmediate(() => {
    void processImportJob(jobId)
      .then((job) => {
        logInfo(`[ingestion][worker] finished job=${job.id} state=${job.state}`);
      })
      .catch((error) => {
        logError(`[ingestion][worker] failed job=${jobId}`, error);
      });
  });
});

/**
 * Retry FAILED jobs whose `next_retry_at` has passed and whose `retry_count`
 * is still under `maxAttempts`. Designed to be polled by an external scheduler
 * (cron, Cloud Scheduler, etc.) as often as it likes — the endpoint is
 * idempotent and returns 0 retried when nothing's ready. Complements the
 * existing DEAD_LETTERED `/retries/:provider/run` endpoint which is intended
 * for manual re-drive.
 *
 * Must be registered BEFORE the `/retries/:provider/run` route below so
 * Express doesn't route `/retries/failed/run` to the `:provider` pattern.
 */
router.post('/retries/failed/run', authenticateWorker, async (req, res) => {
  const policy = await getRetryPolicyConfig();
  const limitRaw = req.body?.limit;
  const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : undefined;
  const ready = await listFailedJobsReadyForRetry({
    maxAttempts: policy.maxAttempts,
    limit,
  });
  const retriedIds: string[] = [];
  const queue = getJobQueue();
  for (const job of ready) {
    const requeued = await requeueImportJob(job.id);
    if (!requeued) continue; // state-gate filtered a concurrent change out
    try {
      await queue.enqueue(job.id);
      retriedIds.push(job.id);
    } catch (err) {
      logError(`[ingestion][worker] retry enqueue failed job=${job.id}`, err);
    }
  }
  logInfo(`[ingestion][worker] failed-retry tick — eligible=${ready.length}, retried=${retriedIds.length}`);
  res.json({ eligible: ready.length, retried: retriedIds.length, retriedIds });
});

router.post('/retries/:provider/run', authenticateWorker, async (req, res) => {
  const provider = String(req.params.provider ?? 'GLOBAL').trim().toUpperCase();
  const sourceType = provider === 'MAILGUN' ? 'FORWARDED_MAILBOX' : provider === 'GMAIL' ? 'GMAIL_IMPORT' : undefined;
  const policy = await getRetryPolicyConfig();
  const deadLetters = await listDeadLetterImportJobs({ sourceType });
  const eligible = deadLetters.filter((job) => {
    if (job.retryCount >= policy.maxAttempts) return false;
    const updatedAt = new Date(job.updatedAt).getTime();
    const delayMs = calculateRetryDelayMs(job.retryCount + 1, policy.baseDelaySeconds, policy.maxDelaySeconds);
    return Date.now() >= updatedAt + delayMs;
  });
  const retriedJobs = [];
  for (const job of eligible) {
    retriedJobs.push(await requeueDeadLetterImportJob(job.id));
  }
  res.json({ provider, eligible: eligible.length, retried: retriedJobs.length });
});

export default router;
