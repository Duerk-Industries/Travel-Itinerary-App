import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, type TokenPayload } from '../auth';
import { listTrips } from '../db';
import { resolveAndValidateRedirectUri } from '../redirects';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_DEFAULT_FORWARDING_ADDRESS, INGESTION_DEFAULT_FORWARDING_PROVIDER, INGESTION_FEATURE_FLAGS, INGESTION_FORWARDING_SETTINGS_COPY, INGESTION_TIER_RULES, INGESTION_USAGE_KEYS } from '../ingestion/config';
import { assignReviewItemToTrip, deleteReviewItem, getReviewItem, updateReviewItemEdits } from '../ingestion/assignment';
import { manualUploadMiddleware, buildManualUploadPayloads, buildGmailConsentUrl, buildGmailDryRunEntries, buildGmailIngestionPayloads, fetchGmailProfile, GMAIL_READONLY_SCOPE_URL, refreshGmailAccessToken } from '../ingestion/intake';
import { enqueueIngestionPipelineJob } from '../ingestion/orchestrator';
import { listReviewQueueItems, listImportJobsForUser, getReviewQueueSignedUrl, getProviderConnection, disconnectProviderConnections, upsertProviderConnection, updateProviderConnectionStatus, getIngestedDocumentById } from '../ingestion/shared/repository';
import { assertAndConsumeMonthlyQuota, getTierIngestionRules } from '../ingestion/shared/quota';
import { IngestionError } from '../ingestion/shared/userFailures';
import { getEnvValue } from '../env';
import { logError } from '../logger';

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

const ensureGmailFeatureAndTier = async (userId: string, res: any): Promise<{ tierKey: string; rules: TierRules } | null> => {
  const tierAccess = await requireTierAccess(userId, res);
  if (!tierAccess) return null;
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.gmailImport))) {
    res.status(403).json({ error: 'Gmail import is currently disabled.' });
    return null;
  }
  return tierAccess;
};

const getActiveGmailConnection = async (userId: string) => {
  const connection = await getProviderConnection(userId, 'gmail');
  if (!connection) {
    throw new IngestionError('gmail_permission_missing', 400);
  }
  if (connection.status === 'AUTH_EXPIRED') {
    throw new IngestionError('provider_auth_expired', 400);
  }

  const expiresAt = connection.tokenExpiry ? new Date(connection.tokenExpiry).getTime() : null;
  const expired = expiresAt !== null && expiresAt <= Date.now() + 60_000;
  if (!expired && connection.accessToken) {
    return connection;
  }
  if (!connection.refreshToken) {
    throw new IngestionError('provider_auth_expired', 400);
  }

  try {
    const refreshed = await refreshGmailAccessToken({ refreshToken: connection.refreshToken });
    const profile = await fetchGmailProfile(refreshed.accessToken);
    await upsertProviderConnection({
      userId,
      provider: 'gmail',
      accessToken: refreshed.accessToken,
      refreshToken: connection.refreshToken,
      tokenExpiry: refreshed.tokenExpiry,
      scopes: refreshed.scope.length ? refreshed.scope : connection.scopes,
      metadata: {
        ...connection.metadata,
        emailAddress: profile.emailAddress,
        messagesTotal: profile.messagesTotal ?? null,
        threadsTotal: profile.threadsTotal ?? null,
        refreshedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    await updateProviderConnectionStatus({
      userId,
      provider: 'gmail',
      status: 'AUTH_EXPIRED',
      metadata: {
        ...connection.metadata,
        authExpiredAt: new Date().toISOString(),
        lastAuthError: 'refresh_failed',
      },
    });
    logError('[ingestion] gmail provider connection expired', { userId });
    throw new IngestionError('provider_auth_expired', 400);
  }
  const updated = await getProviderConnection(userId, 'gmail');
  if (!updated?.accessToken) {
    throw new IngestionError('provider_auth_expired', 400);
  }
  return updated;
};

router.get('/config', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tierKey, rules } = await getTierIngestionRules(userId);
  const gmailConnection = await getProviderConnection(userId, 'gmail');
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
      scope: GMAIL_READONLY_SCOPE_URL,
      inboxOnly: true,
      dryRunSupported: true,
      connection: gmailConnection
        ? {
            connected: true,
            status: gmailConnection.status,
            emailAddress: String(gmailConnection.metadata.emailAddress ?? ''),
            tokenExpiry: gmailConnection.tokenExpiry ?? null,
            scopes: gmailConnection.scopes,
          }
        : {
            connected: false,
            status: 'DISCONNECTED',
            emailAddress: null,
            tokenExpiry: null,
            scopes: [],
          },
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
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : null;
  const minConfidence = typeof req.query.minConfidence === 'string' ? Number(req.query.minConfidence) : null;
  const maxConfidence = typeof req.query.maxConfidence === 'string' ? Number(req.query.maxConfidence) : null;
  const filtered = items.filter((item) => {
    if (source !== 'ALL' && item.sourceType !== source) return false;
    if (type !== 'ALL' && item.itemType !== type) return false;
    if (status !== 'ALL' && item.status !== status) return false;
    if (dateFrom && item.startDateTimeUtc && item.startDateTimeUtc < dateFrom) return false;
    if (dateTo && item.startDateTimeUtc && item.startDateTimeUtc > dateTo) return false;
    if (minConfidence !== null && Number.isFinite(minConfidence) && item.confidenceScore < minConfidence) return false;
    if (maxConfidence !== null && Number.isFinite(maxConfidence) && item.confidenceScore > maxConfidence) return false;
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
  const rawDocument = await getIngestedDocumentById(item.rawDocId);
  res.json({
    item,
    signedDocument: signed,
    documentSummary: rawDocument
      ? {
          normalizationQuality: rawDocument.normalizationQuality,
          virusScanStatus: rawDocument.virusScanStatus,
          mimeType: rawDocument.mimeType,
          originalFilename: rawDocument.originalFilename,
        }
      : null,
  });
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
      jobs.push(await enqueueIngestionPipelineJob(payload, tierAccess.rules.llmEscalations === 'LARGE_ALLOWED', tierAccess.rules.llmEscalations !== 'NONE'));
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
    logError('Ingestion upload failed', error);
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

router.get('/gmail/status', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tierAccess = await ensureGmailFeatureAndTier(userId, res);
  if (!tierAccess) return;
  const connection = await getProviderConnection(userId, 'gmail');
  res.json({
    connected: Boolean(connection),
    status: connection?.status ?? 'DISCONNECTED',
    scope: GMAIL_READONLY_SCOPE_URL,
    emailAddress: connection ? String(connection.metadata.emailAddress ?? '') : null,
    tokenExpiry: connection?.tokenExpiry ?? null,
    scopes: connection?.scopes ?? [],
    lookbackDays: tierAccess.rules.gmailLookbackDays,
  });
});

router.post('/gmail/connect', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await ensureGmailFeatureAndTier(userId, res))) return;
  const webUrl = getEnvValue('WEB_URL', { defaultValue: `${req.protocol}://${req.get('host')}` })!;
  const rawRedirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  const { redirectUri, error } = resolveAndValidateRedirectUri(rawRedirectUri, webUrl);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const { authUrl, scope } = buildGmailConsentUrl({ userId, redirectUri, request: req });
  res.json({
    authUrl,
    scope,
    consentReview: [
      'Read-only access to Gmail inbox messages and attachments.',
      'No permission to send, modify, or delete Gmail content.',
      'Only travel-relevant content needed for extraction should be retained.',
    ],
  });
});

router.post('/gmail/dry-run', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tierAccess = await ensureGmailFeatureAndTier(userId, res);
  if (!tierAccess) return;
  try {
    await assertAndConsumeMonthlyQuota({
      userId,
      usageKey: INGESTION_USAGE_KEYS.gmailSyncs,
      limit: Math.max(1, tierAccess.rules.gmailLookbackDays),
    });
    const connection = await getActiveGmailConnection(userId);
    const messages = await buildGmailDryRunEntries(connection.accessToken!, tierAccess.rules.gmailLookbackDays);
    res.json({
      dryRun: true,
      imported: 0,
      lookbackDays: tierAccess.rules.gmailLookbackDays,
      scope: GMAIL_READONLY_SCOPE_URL,
      messages,
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

router.post('/gmail/import', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tierAccess = await ensureGmailFeatureAndTier(userId, res);
  if (!tierAccess) return;
  try {
    await assertAndConsumeMonthlyQuota({
      userId,
      usageKey: INGESTION_USAGE_KEYS.gmailSyncs,
      limit: Math.max(1, tierAccess.rules.gmailLookbackDays),
    });
    const connection = await getActiveGmailConnection(userId);
    const payloads = await buildGmailIngestionPayloads({
      accessToken: connection.accessToken!,
      userId,
      lookbackDays: tierAccess.rules.gmailLookbackDays,
    });
    const jobs = [];
    for (const payload of payloads) {
      jobs.push(
        await enqueueIngestionPipelineJob(payload, tierAccess.rules.llmEscalations === 'LARGE_ALLOWED', tierAccess.rules.llmEscalations !== 'NONE', {
          enforceFutureDated: true,
        })
      );
    }
    res.status(202).json({
      imported: payloads.length,
      lookbackDays: tierAccess.rules.gmailLookbackDays,
      jobs,
    });
  } catch (error) {
    if (error instanceof IngestionError) {
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }
    res.status(400).json({ error: 'Unable to run Gmail import.' });
  }
});

router.post('/gmail/disconnect', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await ensureGmailFeatureAndTier(userId, res))) return;
  await disconnectProviderConnections(userId, 'gmail');
  res.json({ disconnected: true });
});

export default router;
