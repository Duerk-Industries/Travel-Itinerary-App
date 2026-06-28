import { Router } from 'express';
import { authenticate, TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import { isStripeBillingEnabled, isStripeLiveMode } from '../config/stripeBilling';
import {
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  listAvailablePlans,
  syncUserSubscriptionsFromStripe,
} from '../billing/billingService';
import { reconcileUserTierFromBillingById } from '../billing/subscriptionEntitlementService';
import { createCheckoutSessionDto, createPortalSessionDto } from '../billing/billingDtos';
import { logError } from '../logger';
import { incrementMetric } from '../metrics';

const router = Router();
router.use(authenticate);

const billingEnabled = (res: any): boolean => {
  if (!isStripeBillingEnabled()) {
    res.status(503).json({ error: 'Billing is not enabled on this server.' });
    return false;
  }
  return true;
};

/**
 * GET /api/billing/status
 * Intentionally does not guard on billingEnabled — the frontend always needs
 * to know the current tier and subscription state, even when billing is
 * disabled (e.g. admin-granted tiers, seeded access).
 */
router.get('/status', async (req, res) => {
  const { userId, role } = (req as any).user as TokenPayload;
  try {
    const status = await getBillingStatus(userId, role);
    res.json(status);
  } catch (err) {
    logError('[billing] GET /status failed', { userId, error: (err as Error)?.message });
    incrementMetric('billing.status_failed');
    res.status(500).json({ error: 'Failed to retrieve billing status.' });
  }
});

/** GET /api/billing/plans */
router.get('/plans', async (_req, res) => {
  if (!billingEnabled(res)) return;
  try {
    const plans = await listAvailablePlans();
    res.json({ plans });
  } catch (err) {
    logError('[billing] GET /plans failed', { error: (err as Error)?.message });
    res.status(500).json({ error: 'Failed to retrieve plans.' });
  }
});

/** POST /api/billing/checkout-session */
router.post('/checkout-session', async (req, res) => {
  if (!billingEnabled(res)) return;
  const { userId, email, role } = (req as any).user as TokenPayload;

  const dto = readDto(createCheckoutSessionDto, req.body, res);
  if (!dto) return;

  try {
    const result = await createCheckoutSession({
      userId,
      email,
      planKey: dto.planKey,
      idempotencyKey: dto.idempotencyKey,
      livemode: isStripeLiveMode(),
    });

    if ('alreadySubscribed' in result) {
      res.status(409).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to create checkout session.';
    const status =
      message.includes('Checkout is disabled') ||
      message.includes('wrong Stripe mode') ||
      message.includes('No active Price ID configured') ||
      message.includes('STRIPE_CHECKOUT_SUCCESS_URL') ||
      message.includes('STRIPE_CHECKOUT_CANCEL_URL')
        ? 400
        : 500;
    logError('[billing] POST /checkout-session failed', {
      userId,
      planKey: dto.planKey,
      error: message,
    });
    res.status(status).json({
      error: 'Failed to create checkout session.',
      ...(process.env.NODE_ENV === 'test' ? { details: message } : {}),
    });
  }
});

/** POST /api/billing/portal-session */
router.post('/portal-session', async (req, res) => {
  if (!billingEnabled(res)) return;
  const { userId } = (req as any).user as TokenPayload;

  const dto = readDto(createPortalSessionDto, req.body ?? {}, res);
  if (!dto) return;

  try {
    const result = await createPortalSession({ userId });
    res.status(201).json(result);
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (msg.includes('No billing account found')) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes('STRIPE_PORTAL_RETURN_URL')) {
      res.status(400).json({
        error: 'Failed to create portal session.',
        ...(process.env.NODE_ENV === 'test' ? { details: msg } : {}),
      });
      return;
    }
    logError('[billing] POST /portal-session failed', { userId, error: msg });
    res.status(500).json({
      error: 'Failed to create portal session.',
      ...(process.env.NODE_ENV === 'test' ? { details: msg } : {}),
    });
  }
});

/**
 * POST /api/billing/refresh
 * Explicit re-reconciliation after returning from Stripe Checkout.
 * Allows the client to force a tier check without waiting for the next webhook.
 */
router.post('/refresh', async (req, res) => {
  const { userId } = (req as any).user as TokenPayload;
  try {
    if (isStripeBillingEnabled()) {
      await syncUserSubscriptionsFromStripe(userId);
    }
    const result = await reconcileUserTierFromBillingById(userId, {
      reason: 'Client-triggered refresh after checkout return',
    });
    const status = await getBillingStatus(userId, ((req as any).user as TokenPayload).role);
    res.json({ reconciled: result, status });
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    logError('[billing] POST /refresh failed', { userId, error: message });
    res.status(500).json({
      error: 'Failed to refresh billing status.',
      ...(process.env.NODE_ENV === 'test' ? { details: message } : {}),
    });
  }
});

export default router;
