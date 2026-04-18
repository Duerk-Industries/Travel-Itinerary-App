import { Router } from 'express';
import { clearExtractionCache, getIngestionObservabilitySnapshot, getRetryPolicyConfig, listDeadLetterImportJobs, upsertRetryPolicyConfig } from '../ingestion/shared/repository';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_FEATURE_FLAGS } from '../ingestion/config';
import { requeueDeadLetterImportJob } from '../ingestion/orchestrator';

const router = Router();

const ensureEnabled = async (res: any): Promise<boolean> => {
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.adminObservability))) {
    res.status(403).json({ error: 'Ingestion observability is currently disabled.' });
    return false;
  }
  return true;
};

router.get('/metrics', async (_req, res) => {
  if (!(await ensureEnabled(res))) return;
  const snapshot = await getIngestionObservabilitySnapshot();
  res.json(snapshot);
});

router.get('/retry-config', async (_req, res) => {
  if (!(await ensureEnabled(res))) return;
  const config = await getRetryPolicyConfig();
  res.json(config);
});

router.patch('/retry-config', async (req, res) => {
  if (!(await ensureEnabled(res))) return;
  const maxAttempts = Number(req.body?.maxAttempts);
  const baseDelaySeconds = Number(req.body?.baseDelaySeconds);
  const maxDelaySeconds = Number(req.body?.maxDelaySeconds);
  const alertThresholdPercent = Number(req.body?.alertThresholdPercent);
  if (![maxAttempts, baseDelaySeconds, maxDelaySeconds, alertThresholdPercent].every(Number.isFinite)) {
    res.status(400).json({ error: 'All retry policy fields must be numeric.' });
    return;
  }
  const updated = await upsertRetryPolicyConfig({
    maxAttempts,
    baseDelaySeconds,
    maxDelaySeconds,
    alertThresholdPercent,
  });
  res.json(updated);
});

router.post('/dead-letter/re-drive', async (req, res) => {
  if (!(await ensureEnabled(res))) return;
  const provider = String(req.body?.provider ?? 'ALL').trim().toUpperCase();
  const sourceType = provider === 'MAILGUN' ? 'FORWARDED_MAILBOX' : provider === 'GMAIL' ? 'GMAIL_IMPORT' : undefined;
  const startedAfter = typeof req.body?.startedAfter === 'string' ? req.body.startedAfter : null;
  const endedBefore = typeof req.body?.endedBefore === 'string' ? req.body.endedBefore : null;
  const jobs = await listDeadLetterImportJobs({ sourceType, startedAfter, endedBefore });
  const retried = [];
  for (const job of jobs) {
    retried.push(await requeueDeadLetterImportJob(job.id));
  }
  res.json({
    provider,
    matched: jobs.length,
    retried: retried.length,
  });
});

router.post('/clear-cache', async (_req, res) => {
  if (!(await ensureEnabled(res))) return;
  const result = await clearExtractionCache();
  res.json(result);
});

export default router;
