import { Router } from 'express';
import bodyParser from 'body-parser';
import { logError, logInfo } from '../logger';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_DEFAULT_FORWARDING_PROVIDER, INGESTION_FEATURE_FLAGS, INGESTION_USAGE_KEYS } from '../ingestion/config';
import { buildMailgunWebhookPayloads, mailgunWebhookMiddleware, resolveMailgunWebhookUser, validateMailgunWebhookSignature } from '../ingestion/intake/mailgun';
import { enqueueIngestionPipelineJob } from '../ingestion/orchestrator';
import { getTierIngestionRules, assertAndConsumeMonthlyQuota } from '../ingestion/shared/quota';
import { IngestionError } from '../ingestion/shared/userFailures';

const router = Router();
router.use(bodyParser.json({ limit: '5mb' }));
router.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

router.post('/mailgun', mailgunWebhookMiddleware, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
  const describeRequest = () => ({
    provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
    recipient: String(body.recipient ?? ''),
    sender: String(body.sender ?? body.from ?? ''),
    subject: String(body.subject ?? ''),
    fileCount: files.length,
    files: files.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    })),
    contentType: req.get('content-type') ?? '',
    userAgent: req.get('user-agent') ?? '',
  });

  logInfo(`[ingestion][mailgun] webhook received recipient="${String(body.recipient ?? '')}" sender="${String(body.sender ?? body.from ?? '')}" files=${files.length}`);

  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox))) {
    logInfo('[ingestion][mailgun] webhook rejected because forwarded mailbox feature flag is disabled');
    res.status(403).json({ error: 'Forwarded mailbox ingestion is currently disabled.' });
    return;
  }

  try {
    await validateMailgunWebhookSignature(body);
    logInfo('[ingestion][mailgun] webhook signature accepted');
    const resolvedUser = await resolveMailgunWebhookUser(body);
    if (!resolvedUser) {
      logInfo('[ingestion][mailgun] webhook rejected because no matching user account was found');
      res.status(406).json({ error: 'No eligible user account matched this forwarded message.' });
      return;
    }

    const { tierKey, rules } = await getTierIngestionRules(resolvedUser.userId);
    logInfo(`[ingestion][mailgun] resolved sender to user=${resolvedUser.userId} tier=${tierKey}`);
    if (tierKey === 'free') {
      logInfo(`[ingestion][mailgun] webhook rejected because user=${resolvedUser.userId} is on free tier`);
      res.status(406).json({ error: 'Forwarded mailbox ingestion requires Premium or Pro.' });
      return;
    }

    await assertAndConsumeMonthlyQuota({
      userId: resolvedUser.userId,
      usageKey: INGESTION_USAGE_KEYS.forwardedMailboxDeliveries,
      limit: rules.monthlyUploads,
    });

    const payloads = await buildMailgunWebhookPayloads(req, resolvedUser.userId, resolvedUser.senderEmail);
    logInfo(`[ingestion][mailgun] built payloads user=${resolvedUser.userId} payloads=${payloads.length}`);
    const jobs = [];
    for (const payload of payloads) {
      jobs.push(await enqueueIngestionPipelineJob(payload, rules.llmEscalations === 'LARGE_ALLOWED', rules.llmEscalations !== 'NONE'));
    }
    logInfo(`[ingestion][mailgun] queued jobs user=${resolvedUser.userId} jobs=${jobs.map((job) => job.id).join(',')}`);

    res.status(202).json({
      accepted: true,
      provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
      payloadCount: payloads.length,
      jobs,
    });
  } catch (error) {
    if (error instanceof IngestionError) {
      logError(`[ingestion][mailgun] webhook rejected code=${error.code}`, describeRequest());
      const permanent = error.httpStatus === 406 || ['quota_exceeded', 'unsupported_file_type', 'file_too_large', 'virus_scan_failed'].includes(error.code);
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(permanent ? 406 : error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }

    logError('[ingestion] mailgun webhook failed', {
      ...describeRequest(),
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json({ error: 'Mailbox webhook processing failed temporarily.' });
  }
});

export default router;
