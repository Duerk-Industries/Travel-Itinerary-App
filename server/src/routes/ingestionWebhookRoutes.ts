import { Router } from 'express';
import { logError } from '../logger';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_DEFAULT_FORWARDING_PROVIDER, INGESTION_FEATURE_FLAGS, INGESTION_USAGE_KEYS } from '../ingestion/config';
import { buildMailgunWebhookPayloads, mailgunWebhookMiddleware, resolveMailgunWebhookUser, validateMailgunWebhookSignature } from '../ingestion/intake/mailgun';
import { runIngestionPipeline } from '../ingestion/orchestrator';
import { getTierIngestionRules, assertAndConsumeMonthlyQuota } from '../ingestion/shared/quota';
import { IngestionError } from '../ingestion/shared/userFailures';

const router = Router();

router.post('/mailgun', mailgunWebhookMiddleware, async (req, res) => {
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox))) {
    res.status(403).json({ error: 'Forwarded mailbox ingestion is currently disabled.' });
    return;
  }

  try {
    await validateMailgunWebhookSignature((req.body ?? {}) as Record<string, unknown>);
    const resolvedUser = await resolveMailgunWebhookUser((req.body ?? {}) as Record<string, unknown>);
    if (!resolvedUser) {
      res.status(406).json({ error: 'No eligible user account matched this forwarded message.' });
      return;
    }

    const { tierKey, rules } = await getTierIngestionRules(resolvedUser.userId);
    if (tierKey === 'free') {
      res.status(406).json({ error: 'Forwarded mailbox ingestion requires Premium or Pro.' });
      return;
    }

    await assertAndConsumeMonthlyQuota({
      userId: resolvedUser.userId,
      usageKey: INGESTION_USAGE_KEYS.forwardedMailboxDeliveries,
      limit: rules.monthlyUploads,
    });

    const payloads = await buildMailgunWebhookPayloads(req, resolvedUser.userId, resolvedUser.senderEmail);
    const jobs = [];
    for (const payload of payloads) {
      jobs.push(await runIngestionPipeline(payload, rules.llmEscalations === 'LARGE_ALLOWED', rules.llmEscalations !== 'NONE'));
    }

    res.status(202).json({
      accepted: true,
      provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
      payloadCount: payloads.length,
      jobs,
    });
  } catch (error) {
    if (error instanceof IngestionError) {
      const permanent = error.httpStatus === 406 || ['quota_exceeded', 'unsupported_file_type', 'file_too_large', 'virus_scan_failed'].includes(error.code);
      if (error.retryAfterSeconds) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      res.status(permanent ? 406 : error.httpStatus).json({ error: error.message, code: error.code });
      return;
    }

    logError('[ingestion] mailgun webhook failed', {
      provider: INGESTION_DEFAULT_FORWARDING_PROVIDER,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json({ error: 'Mailbox webhook processing failed temporarily.' });
  }
});

export default router;
