import { Router } from 'express';
import { clearExtractionCache, countRetentionEligibleRows, getIngestionObservabilitySnapshot, getRetryPolicyConfig, listDeadLetterImportJobs, upsertRetryPolicyConfig } from '../ingestion/shared/repository';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_FEATURE_FLAGS, INGESTION_RETENTION_DEAD_LETTER_DAYS } from '../ingestion/config';
import { requeueDeadLetterImportJob } from '../ingestion/orchestrator';
import { writeAuditLog } from '../db';
import { logError } from '../logger';
import type { TokenPayload } from '../auth';

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
  const actorId = (req as any).user ? ((req as any).user as TokenPayload).userId : null;
  try {
    await writeAuditLog({
      actorUserId: actorId,
      action: 'INGESTION_DEAD_LETTER_RE_DRIVEN' as any,
      beforeState: { provider, sourceType, startedAfter, endedBefore, matched: jobs.length },
      afterState: { retried: retried.length, retriedJobIds: retried.map((j) => j.id).slice(0, 100) },
      reason: `Re-drive dead-lettered jobs (${provider})`,
    });
  } catch (err) {
    logError('[ingestion-admin] audit write failed on dead-letter re-drive', err);
  }
  res.json({
    provider,
    matched: jobs.length,
    retried: retried.length,
  });
});

/**
 * Retention preview. Dry-run count of how many rows would be cleaned up if
 * the retention sweep ran NOW, with an optional `?days=N` override so an
 * operator can preview a proposed retention-window change before applying
 * it. Does not mutate any row.
 */
router.get('/retention-preview', async (req, res) => {
  if (!(await ensureEnabled(res))) return;
  const daysParam = req.query.days ? parseInt(String(req.query.days), 10) : undefined;
  const days = Number.isFinite(daysParam) && (daysParam as number) > 0
    ? (daysParam as number)
    : INGESTION_RETENTION_DEAD_LETTER_DAYS;
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const counts = await countRetentionEligibleRows(cutoffIso);
  res.json({
    cutoffIso,
    retentionDays: days,
    deadLetterPayloadsEligible: counts.deadLetterPayloadsEligible,
    normalizedTextEligible: counts.normalizedTextEligible,
  });
});

router.post('/clear-cache', async (_req, res) => {
  if (!(await ensureEnabled(res))) return;
  const result = await clearExtractionCache();
  res.json(result);
});

export default router;
