import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import {
  listBillingPlanConfigs,
  getBillingPlanConfig,
  upsertBillingPlanConfig,
  listBillingPriceHistory,
  insertBillingPriceHistory,
  deactivateOldPricesForPlan,
  writeAuditLog,
  listActiveBillingSubscriptionsForUser,
} from '../db';
import { reconcileUserTierFromBillingById } from '../billing/subscriptionEntitlementService';
import { runReconciliationBatch } from '../billing/subscriptionReconciliationService';
import { getStripeClient } from '../billing/stripeClient';
import { isStripeBillingEnabled, getStripePremiumProductId } from '../config/stripeBilling';
import { logError, logInfo } from '../logger';
import type { BillingPlanKey } from '../types';

// Admin billing routes — mounted at /api/admin/billing (authenticate + requireAdmin applied in app.ts)
const router = Router();

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

const patchBillingConfigDto = z.object({
  trialDays: z.number().int().min(0).max(365).optional(),
  pastDueGraceDays: z.number().int().min(0).max(365).optional(),
  automaticTaxEnabled: z.boolean().optional(),
  promotionCodesEnabled: z.boolean().optional(),
  isCheckoutEnabled: z.boolean().optional(),
});

const publishPriceDto = z.object({
  unitAmountCents: z.number().int().min(1).max(1_000_000),
  currency: z.string().length(3).default('usd'),
});

// ---------------------------------------------------------------------------
// GET /api/admin/billing/config
// ---------------------------------------------------------------------------

router.get('/config', async (_req, res) => {
  try {
    const configs = await listBillingPlanConfigs();
    res.json({
      billingEnabled: isStripeBillingEnabled(),
      plans: configs,
    });
  } catch (err) {
    logError('[admin-billing] GET /config failed', { error: (err as Error)?.message });
    res.status(500).json({ error: 'Failed to retrieve billing config.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/billing/config/:planKey
// ---------------------------------------------------------------------------

router.patch('/config/:planKey', async (req, res) => {
  const planKey = req.params.planKey as BillingPlanKey;
  const actorId = ((req as any).user as TokenPayload).userId;

  const dto = readDto(patchBillingConfigDto, req.body, res);
  if (!dto) return;

  const hasChanges = Object.keys(dto).length > 0;
  if (!hasChanges) {
    res.status(400).json({ error: 'No fields provided to update.' });
    return;
  }

  try {
    const before = await getBillingPlanConfig(planKey);
    const updated = await upsertBillingPlanConfig({ planKey, ...dto, updatedBy: actorId });
    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: null,
      action: 'USER_TIER_CHANGED',
      beforeState: before ? { trialDays: before.trialDays, pastDueGraceDays: before.pastDueGraceDays } : null,
      afterState: { trialDays: updated.trialDays, pastDueGraceDays: updated.pastDueGraceDays, planKey },
      reason: `Admin updated billing config for ${planKey}`,
    });
    res.json(updated);
  } catch (err) {
    logError('[admin-billing] PATCH /config failed', { planKey, error: (err as Error)?.message });
    res.status(500).json({ error: 'Failed to update billing config.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/billing/prices
// ---------------------------------------------------------------------------

router.get('/prices', async (_req, res) => {
  try {
    const history = await listBillingPriceHistory();
    res.json({ prices: history });
  } catch (err) {
    logError('[admin-billing] GET /prices failed', { error: (err as Error)?.message });
    res.status(500).json({ error: 'Failed to retrieve price history.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/billing/plans/:planKey/price
// Publish a new Stripe Price for the selected plan and record it in history.
// ---------------------------------------------------------------------------

router.post('/plans/:planKey/price', async (req, res) => {
  if (!isStripeBillingEnabled()) {
    res.status(503).json({ error: 'Billing is not enabled.' });
    return;
  }

  const planKey = req.params.planKey as BillingPlanKey;
  const actorId = ((req as any).user as TokenPayload).userId;

  if (planKey !== 'premium_monthly' && planKey !== 'premium_annual') {
    res.status(400).json({ error: 'planKey must be premium_monthly or premium_annual.' });
    return;
  }

  const dto = readDto(publishPriceDto, req.body, res);
  if (!dto) return;

  const stripeProductId = getStripePremiumProductId();
  if (!stripeProductId) {
    res.status(503).json({ error: 'STRIPE_PREMIUM_PRODUCT_ID is not configured.' });
    return;
  }

  const interval: Stripe.PriceCreateParams.Recurring.Interval =
    planKey === 'premium_annual' ? 'year' : 'month';

  try {
    const stripe = getStripeClient();
    const stripePrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: dto.unitAmountCents,
      currency: dto.currency,
      recurring: { interval },
      metadata: { planKey, createdBy: actorId },
    });

    await deactivateOldPricesForPlan(planKey, stripePrice.id);

    const priceRecord = await insertBillingPriceHistory({
      stripePriceId: stripePrice.id,
      planKey,
      stripeProductId,
      unitAmountCents: dto.unitAmountCents,
      currency: dto.currency,
      interval,
      livemode: stripePrice.livemode,
      activeForNewCheckout: true,
      createdBy: actorId,
    });

    await upsertBillingPlanConfig({
      planKey,
      activeStripePriceId: stripePrice.id,
      unitAmountCents: dto.unitAmountCents,
      currency: dto.currency,
      updatedBy: actorId,
    });

    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: null,
      action: 'USER_TIER_CHANGED',
      beforeState: null,
      afterState: { planKey, stripePriceId: stripePrice.id, unitAmountCents: dto.unitAmountCents },
      reason: `Admin published new Stripe Price for ${planKey}`,
    });

    logInfo(`[admin-billing] New Stripe Price published planKey=${planKey} priceId=${stripePrice.id} cents=${dto.unitAmountCents} actorId=${actorId}`);

    res.status(201).json({ stripePriceId: stripePrice.id, priceRecord });
  } catch (err) {
    logError('[admin-billing] POST /plans/:planKey/price failed', {
      planKey,
      error: (err as Error)?.message,
    });
    res.status(500).json({ error: 'Failed to publish new price.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/billing/reconcile/:userId
// Trigger manual reconciliation for a specific user.
// ---------------------------------------------------------------------------

router.post('/reconcile/:userId', async (req, res) => {
  const actorId = ((req as any).user as TokenPayload).userId;
  const targetUserId = req.params.userId;

  try {
    const result = await reconcileUserTierFromBillingById(targetUserId, {
      reason: `Manual reconciliation triggered by admin ${actorId}`,
    });
    const subscriptions = await listActiveBillingSubscriptionsForUser(targetUserId);
    res.json({ result, subscriptions });
  } catch (err) {
    logError('[admin-billing] POST /reconcile failed', {
      targetUserId,
      error: (err as Error)?.message,
    });
    res.status(500).json({ error: 'Failed to reconcile user billing.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/billing/reconcile-batch
// Run a reconciliation batch over stale subscriptions.
// ---------------------------------------------------------------------------

router.post('/reconcile-batch', async (req, res) => {
  if (!isStripeBillingEnabled()) {
    res.status(503).json({ error: 'Billing is not enabled.' });
    return;
  }
  const { olderThanMinutes, limit } = req.body ?? {};
  try {
    const summary = await runReconciliationBatch(
      typeof olderThanMinutes === 'number' ? olderThanMinutes : 60,
      typeof limit === 'number' ? limit : 100,
    );
    res.json(summary);
  } catch (err) {
    logError('[admin-billing] POST /reconcile-batch failed', { error: (err as Error)?.message });
    res.status(500).json({ error: 'Reconciliation batch failed.' });
  }
});

export default router;
