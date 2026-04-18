import { Router } from 'express';
import bodyParser from 'body-parser';
import { getEnvValue } from '../env';
import { processImportJob } from '../ingestion/orchestrator';
import { getRetryPolicyConfig, listDeadLetterImportJobs } from '../ingestion/shared/repository';
import { requeueDeadLetterImportJob } from '../ingestion/orchestrator';
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

router.post('/jobs/:jobId/run', authenticateWorker, async (req, res) => {
  try {
    logInfo(`[ingestion][worker] starting job=${req.params.jobId}`);
    const job = await processImportJob(req.params.jobId);
    logInfo(`[ingestion][worker] finished job=${job.id} state=${job.state}`);
    res.status(202).json({ accepted: true, jobId: job.id, state: job.state });
  } catch (error) {
    logError(`[ingestion][worker] failed job=${req.params.jobId}`, error);
    res.status(500).json({ error: 'Worker failed to process import job.' });
  }
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
