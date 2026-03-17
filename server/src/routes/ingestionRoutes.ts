import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, type TokenPayload } from '../auth';
import { listTrips } from '../db';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_DEFAULT_FORWARDING_ADDRESS, INGESTION_DEFAULT_FORWARDING_PROVIDER, INGESTION_FEATURE_FLAGS, INGESTION_FORWARDING_SETTINGS_COPY, INGESTION_TIER_RULES, INGESTION_USAGE_KEYS } from '../ingestion/config';
import { assignReviewItemToTrip, deleteReviewItem, getReviewItem, updateReviewItemEdits } from '../ingestion/assignment';
import { manualUploadMiddleware, buildManualUploadPayloads } from '../ingestion/intake';
import { runIngestionPipeline } from '../ingestion/orchestrator';
import { listReviewQueueItems, listImportJobsForUser, getReviewQueueSignedUrl } from '../ingestion/shared/repository';
import { assertAndConsumeMonthlyQuota, getTierIngestionRules } from '../ingestion/shared/quota';
import { IngestionError } from '../ingestion/shared/userFailures';

const router = Router();
router.use(bodyParser.json({ limit: '2mb' }));
router.use(authenticate);

type TierRules = (typeof INGESTION_TIER_RULES)[keyof typeof INGESTION_TIER_RULES];

const requireTierAccess = async (userId: string, res: any): Promise<{ tierKey: string; rules: TierRules } | null> => {
  const { tierKey, rules } = await getTierIngestionRules(userId);
  if (tierKey === 'free') {
    res.status(403).json({ error: 'This feature is available for Premium and Pro users only.' });
    return null;
  }
  return { tierKey: String(tierKey), rules };
};

router.get('/config', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tierKey, rules } = await getTierIngestionRules(userId);
  const [manualFlag, mailboxFlag, gmailFlag] = await Promise.all([
    isFeatureEnabled(INGESTION_FEATURE_FLAGS.manualUpload),
    isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox),
    isFeatureEnabled(INGESTION_FEATURE_FLAGS.gmailImport),
  ]);
  res.json({
    tierKey,
    features: {
      manualUpload: manualFlag && tierKey !== 'free',
      forwardedMailbox: mailboxFlag && tierKey !== 'free',
      gmailImport: gmailFlag && tierKey !== 'free',
    },
    quotas: rules,
    forwarding: {
      provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
      currentAddress: INGESTION_DEFAULT_FORWARDING_ADDRESS,
      instructions: INGESTION_FORWARDING_SETTINGS_COPY,
      adminManagedNote: 'Changing the destination inbox may require an admin update and provider redeploy.',
    },
    gmail: {
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      inboxOnly: true,
      dryRunSupported: true,
    },
  });
});

router.get('/review-items', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const items = await listReviewQueueItems(userId);
  const source = String(req.query.source ?? 'ALL');
  const type = String(req.query.type ?? 'ALL');
  const status = String(req.query.status ?? 'ALL');
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (source !== 'ALL' && item.sourceType !== source) return false;
    if (type !== 'ALL' && item.itemType !== type) return false;
    if (status !== 'ALL' && item.status !== status) return false;
    if (!search) return true;
    const haystack = JSON.stringify({
      provider: item.providerVendor,
      confirmation: item.confirmationNumber,
      fields: item.extractedFields,
    }).toLowerCase();
    return haystack.includes(search);
  });
  res.json({ items: filtered });
});

router.get('/jobs', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const jobs = await listImportJobsForUser(userId);
  res.json({ jobs });
});

router.get('/review-items/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const item = await getReviewItem(userId, req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Review item not found.' });
    return;
  }
  const signed = await getReviewQueueSignedUrl(item.rawDocId);
  res.json({ item, signedDocument: signed });
});

router.post('/upload', manualUploadMiddleware.array('files', 10), async (req, res) => {
  const user = (req as any).user as TokenPayload;
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.manualUpload))) {
    res.status(403).json({ error: 'Ingestion is currently disabled.' });
    return;
  }
  const tierAccess = await requireTierAccess(user.userId, res);
  if (!tierAccess) return;
  try {
    await assertAndConsumeMonthlyQuota({
      userId: user.userId,
      usageKey: INGESTION_USAGE_KEYS.manualUploads,
      limit: tierAccess.rules.monthlyUploads,
    });
    const payloads = await buildManualUploadPayloads(req, user.userId);
    const jobs = [];
    for (const payload of payloads) {
      jobs.push(await runIngestionPipeline(payload, tierAccess.rules.llmEscalations === 'LARGE_ALLOWED', tierAccess.rules.llmEscalations !== 'NONE'));
    }
    res.status(202).json({ jobs });
  } catch (error) {
    if (error instanceof IngestionError) {
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Ingestion upload failed', error);
    res.status(400).json({ error: 'Unable to process upload.' });
  }
});

router.patch('/review-items/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const editedFields = (req.body?.editedFields ?? {}) as Record<string, unknown>;
  const updated = await updateReviewItemEdits(userId, req.params.id, editedFields);
  res.json(updated);
});

router.post('/review-items/:id/assign', async (req, res) => {
  const user = (req as any).user as TokenPayload;
  if (!(await requireTierAccess(user.userId, res))) return;
  const tripId = String(req.body?.tripId ?? '').trim();
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required.' });
    return;
  }
  try {
    const result = await assignReviewItemToTrip({
      userId: user.userId,
      parsedItemId: req.params.id,
      tripId,
      assignedByUserId: user.userId,
      editedFields: (req.body?.editedFields ?? {}) as Record<string, unknown>,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String((error as Error).message ?? 'Assignment failed.') });
  }
});

router.delete('/review-items/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const updated = await deleteReviewItem(userId, req.params.id);
  res.json(updated);
});

router.get('/assignment/trips', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await requireTierAccess(userId, res))) return;
  const trips = await listTrips(userId);
  res.json({ trips });
});

router.get('/forwarding', async (_req, res) => {
  const enabled = await isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox);
  res.status(enabled ? 200 : 403).json({
    enabled,
    provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
    currentAddress: INGESTION_DEFAULT_FORWARDING_ADDRESS,
    instructions: INGESTION_FORWARDING_SETTINGS_COPY,
  });
});

router.post('/gmail/dry-run', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tierAccess = await requireTierAccess(userId, res);
  if (!tierAccess) return;
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.gmailImport))) {
    res.status(403).json({ error: 'Gmail import is currently disabled.' });
    return;
  }
  try {
    await assertAndConsumeMonthlyQuota({
      userId,
      usageKey: INGESTION_USAGE_KEYS.gmailSyncs,
      limit: Math.max(1, tierAccess.rules.gmailLookbackDays),
    });
    res.json({
      dryRun: true,
      imported: 0,
      lookbackDays: tierAccess.rules.gmailLookbackDays,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      messages: [],
    });
  } catch (error) {
    if (error instanceof IngestionError) {
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }
    res.status(400).json({ error: 'Unable to run Gmail dry run.' });
  }
});

export default router;
