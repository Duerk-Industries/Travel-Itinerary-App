import { Router } from 'express';
import { getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import {
  runReconciliationBatch,
  scheduleNextBillingGraceExpiry,
} from '../billing/subscriptionReconciliationService';
import { isStripeBillingEnabled } from '../config/stripeBilling';

/**
 * Internal billing routes — called by Cloud Scheduler, not by clients.
 *
 * Secured with a shared secret in X-Billing-Scheduler-Secret rather than an
 * application admin JWT, so that Cloud Scheduler does not need to obtain or
 * rotate application tokens.
 *
 * Cloud Scheduler setup (per environment):
 *   gcloud scheduler jobs create http billing-reconcile \
 *     --schedule "every 30 minutes" \
 *     --uri "https://YOUR-API-DOMAIN/api/internal/billing/reconcile" \
 *     --http-method POST \
 *     --headers "X-Billing-Scheduler-Secret=<secret>,Content-Type=application/json" \
 *     --message-body "{}" \
 *     --oidc-service-account-email <scheduler-sa>@<project>.iam.gserviceaccount.com \
 *     --oidc-token-audience "https://YOUR-API-DOMAIN" \
 *     --time-zone "UTC"
 *
 * The --oidc-* flags are optional extra hardening when the Cloud Run service is
 * not restricted to IAM-only callers. If the service is public, the shared
 * secret in X-Billing-Scheduler-Secret is the primary guard.
 */

const router = Router();

const authenticateScheduler = (req: any, res: any, next: any): void => {
  const configured = getEnvValue('BILLING_SCHEDULER_SECRET');
  if (!configured) {
    logError('[billing][internal] BILLING_SCHEDULER_SECRET is not configured — rejecting request');
    res.status(503).json({ error: 'Scheduler secret not configured.' });
    return;
  }
  const provided = String(req.header('X-Billing-Scheduler-Secret') ?? '');
  if (!provided || provided !== configured) {
    logError('[billing][internal] Rejected request with invalid scheduler secret');
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  next();
};

/**
 * POST /api/internal/billing/reconcile
 *
 * Runs a reconciliation batch (re-syncs stale subscriptions from Stripe and
 * applies grace-period expirations). Designed to be called by Cloud Scheduler
 * every 30 minutes so that grace-period downgrades are durable across Cloud Run
 * instance restarts.
 *
 * Body (all optional):
 *   { olderThanMinutes?: number, limit?: number }
 */
router.post('/reconcile', authenticateScheduler, async (req, res) => {
  if (!isStripeBillingEnabled()) {
    res.status(503).json({ error: 'Billing is not enabled.' });
    return;
  }

  const { olderThanMinutes, limit } = (req.body ?? {}) as Record<string, unknown>;

  try {
    const summary = await runReconciliationBatch(
      typeof olderThanMinutes === 'number' ? olderThanMinutes : 30,
      typeof limit === 'number' ? limit : 200,
    );

    // Reschedule the in-process grace-expiry timer after each batch so that the
    // fast-path (same instance, same process) stays current.
    await scheduleNextBillingGraceExpiry();

    logInfo(`[billing][internal] Scheduled reconciliation complete: processed=${summary.processed} repaired=${summary.repaired} errors=${summary.errors}`);
    res.json({ ok: true, summary });
  } catch (err) {
    logError('[billing][internal] Reconciliation failed', { error: (err as Error)?.message });
    res.status(500).json({ error: 'Reconciliation failed.' });
  }
});

export default router;
