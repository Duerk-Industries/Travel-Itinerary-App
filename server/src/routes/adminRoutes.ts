import { Router } from 'express';
import bodyParser from 'body-parser';
import {
  listFeatureFlags, setFeatureFlag, writeAuditLog,
  listTiers, getTierByKey, listTierLimits, listTierEntitlements, listFeatures,
  upsertTierLimit, upsertTierEntitlement,
  getUserRole, setUserRole, setUserTier, getCurrentUserTier,
  listAuditLog,
  adminSearchUsers, adminGetUser, adminGetUserData,
} from '../db';
import { TokenPayload } from '../auth';
import { logError } from '../logger';
import {
  getApiBudgetProviderConfig,
  getApiLimitsConfig,
  normalizeApiLimitKeyPart,
  updateApiBudgetProviderConfig,
  updateApiLimitProviderConfig,
} from '../config/apiLimits';
import { getFeatureFlagSeeds } from '../config/featureFlags';
import { getApiUsageSummary } from '../apis/usageLimiter';
import { getApiBudgetSummary } from '../apis/providerBudgeting';

// Admin routes — all guarded by authenticate + requireAdmin in app.ts
const router = Router();
router.use(bodyParser.json());

const getActorId = (req: any): string => (req.user as TokenPayload).userId;

const requireReason = (reason: unknown): string | null => {
  if (typeof reason !== 'string' || reason.trim().length < 3) return null;
  return reason.trim();
};

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const listAdminFeatureFlags = async () => {
  const storedFlags = await listFeatureFlags();
  const seeds = getFeatureFlagSeeds();
  const now = new Date().toISOString();
  const mergedByKey = new Map(
    storedFlags.map((flag) => [
      flag.key,
      {
        ...flag,
        description: seeds[flag.key]?.description ?? null,
      },
    ])
  );

  for (const [key, seed] of Object.entries(seeds)) {
    if (mergedByKey.has(key)) continue;
    mergedByKey.set(key, {
      id: key,
      key,
      enabled: seed.enabled,
      scope: 'global' as const,
      updatedBy: null,
      updatedAt: now,
      createdAt: now,
      description: seed.description ?? null,
    });
  }

  return [...mergedByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
};

router.get('/features', async (_req, res) => {
  try {
    const flags = await listAdminFeatureFlags();
    res.json({ features: flags });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list feature flags' });
  }
});

router.patch('/features/:key/flag', async (req, res) => {
  const { key } = req.params;
  const { enabled, reason } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const flags = await listAdminFeatureFlags();
    const existing = flags.find(f => f.key === key);
    if (!existing) {
      res.status(404).json({ error: `Feature flag not found: ${key}` });
      return;
    }
    const previousEnabled = existing.enabled;
    await setFeatureFlag(key, enabled, actorId);
    const audit = await writeAuditLog({
      actorUserId: actorId,
      action: 'FEATURE_FLAG_UPDATED',
      beforeState: { key, enabled: previousEnabled },
      afterState: { key, enabled },
      reason: reasonStr,
    });
    res.json({ key, enabled, previousEnabled, auditId: audit.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/users', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
  try {
    const result = await adminSearchUsers({ search, page, limit });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to search users', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const user = await adminGetUser(req.params.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    logError('[admin] failed to get user', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.patch('/users/:userId/tier', async (req, res) => {
  const { tierKey, reason } = req.body ?? {};
  if (typeof tierKey !== 'string' || !tierKey.trim()) {
    res.status(400).json({ error: 'tierKey is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const targetId = req.params.userId;
    const targetRole = await getUserRole(targetId);
    const resolvedTierKey = targetRole === 'admin' ? 'pro' : tierKey.trim();
    const before = await getCurrentUserTier(targetId);
    await setUserTier(targetId, resolvedTierKey, 'admin', actorId, reasonStr);
    const after = await getCurrentUserTier(targetId);
    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: targetId,
      action: 'USER_TIER_CHANGED',
      beforeState: { tierKey: before?.tierKey ?? null, requestedTierKey: tierKey.trim() },
      afterState: { tierKey: after?.tierKey ?? null },
      reason: reasonStr,
    });
    res.json({ userId: targetId, tierKey: after?.tierKey ?? null, lockedToPro: targetRole === 'admin' });
  } catch (err: any) {
    if (/not found/i.test(err?.message ?? '')) {
      res.status(404).json({ error: err.message });
      return;
    }
    logError('[admin] failed to change user tier', err);
    res.status(500).json({ error: 'Failed to change user tier' });
  }
});

router.patch('/users/:userId/role', async (req, res) => {
  const { role, reason } = req.body ?? {};
  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const targetId = req.params.userId;
    if (actorId === targetId && role !== 'admin') {
      res.status(403).json({ error: 'Admins cannot revoke their own admin role' });
      return;
    }
    const previousRole = await getUserRole(targetId);
    await setUserRole(targetId, role);
    if (role === 'admin') {
      await setUserTier(targetId, 'pro', 'admin', actorId, 'Admin users are automatically assigned Pro tier');
    }
    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: targetId,
      action: role === 'admin' ? 'USER_ROLE_GRANTED' : 'USER_ROLE_REVOKED',
      beforeState: { role: previousRole },
      afterState: { role },
      reason: reasonStr,
    });
    res.json({ userId: targetId, role, previousRole });
  } catch (err) {
    logError('[admin] failed to change user role', err);
    res.status(500).json({ error: 'Failed to change user role' });
  }
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

router.get('/tiers', async (_req, res) => {
  try {
    const tiers = await listTiers();
    const features = await listFeatures();
    const result = await Promise.all(
      tiers.map(async tier => {
        const limits = await listTierLimits(tier.id);
        const entitlements = await listTierEntitlements(tier.id);
        return {
          ...tier,
          limits,
          entitlements: entitlements.map(e => ({
            ...e,
            featureKey: features.find(f => f.id === e.featureId)?.key ?? null,
          })),
        };
      })
    );
    res.json({ tiers: result });
  } catch (err) {
    logError('[admin] failed to list tiers', err);
    res.status(500).json({ error: 'Failed to list tiers' });
  }
});

router.patch('/tiers/:tierKey/limits/:limitKey', async (req, res) => {
  const { tierKey, limitKey } = req.params;
  const { limitValue, reason } = req.body ?? {};
  if (typeof limitValue !== 'number' || !Number.isFinite(limitValue)) {
    res.status(400).json({ error: 'limitValue (number) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const tier = await getTierByKey(tierKey);
    if (!tier) {
      res.status(404).json({ error: `Tier not found: ${tierKey}` });
      return;
    }
    const limits = await listTierLimits(tier.id);
    const before = limits.find(l => l.limitKey === limitKey)?.limitValue ?? null;
    await upsertTierLimit(tier.id, limitKey, limitValue);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'TIER_LIMIT_UPDATED',
      beforeState: { tierKey, limitKey, limitValue: before },
      afterState: { tierKey, limitKey, limitValue },
      reason: reasonStr,
    });
    res.json({ tierKey, limitKey, limitValue, previous: before });
  } catch (err) {
    logError('[admin] failed to upsert tier limit', err);
    res.status(500).json({ error: 'Failed to update tier limit' });
  }
});

router.patch('/tiers/:tierKey/features/:featureKey', async (req, res) => {
  const { tierKey, featureKey } = req.params;
  const { isAllowed, reason } = req.body ?? {};
  if (typeof isAllowed !== 'boolean') {
    res.status(400).json({ error: 'isAllowed (boolean) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const tiers = await listTiers();
    const tier = await getTierByKey(tierKey);
    if (!tier) {
      res.status(404).json({ error: `Tier not found: ${tierKey}` });
      return;
    }
    const features = await listFeatures();
    const feature = features.find(f => f.key === featureKey);
    if (!feature) {
      res.status(404).json({ error: `Feature not found: ${featureKey}` });
      return;
    }
    const entitlements = await listTierEntitlements(tier.id);
    const before = entitlements.find(e => e.featureId === feature.id)?.isAllowed ?? null;
    if (before === null) {
      const inheritedSourceTiers = tiers
        .filter((candidate) => candidate.rank < tier.rank)
        .sort((a, b) => b.rank - a.rank);
      for (const sourceTier of inheritedSourceTiers) {
        const sourceEntitlements = await listTierEntitlements(sourceTier.id);
        const sourceMatch = sourceEntitlements.find((entry) => entry.featureId === feature.id);
        if (sourceMatch) {
          res.status(409).json({
            error: `Feature '${featureKey}' is inherited from '${sourceTier.key}'. Update the lower tier first.`,
            inheritedFromTierKey: sourceTier.key,
            inheritedValue: sourceMatch.isAllowed,
          });
          return;
        }
      }
    }
    await upsertTierEntitlement(tier.id, feature.id, isAllowed);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'TIER_ENTITLEMENT_UPDATED',
      beforeState: { tierKey, featureKey, isAllowed: before },
      afterState: { tierKey, featureKey, isAllowed },
      reason: reasonStr,
    });
    res.json({ tierKey, featureKey, isAllowed, previous: before });
  } catch (err) {
    logError('[admin] failed to upsert tier entitlement', err);
    res.status(500).json({ error: 'Failed to update tier entitlement' });
  }
});

// ---------------------------------------------------------------------------
// User data (aggregate stats)
// ---------------------------------------------------------------------------

router.get('/user-data', async (req, res) => {
  const windowParam = req.query.window as string | undefined;
  const window = (windowParam === '7d' || windowParam === '30d' || windowParam === 'all-time')
    ? windowParam
    : undefined;
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
  try {
    const result = await adminGetUserData({ window, page, limit });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to get user data', err);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

router.get('/audit-log', async (req, res) => {
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const actorUserId = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : undefined;
  const targetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  try {
    const result = await listAuditLog({ page, limit, actorUserId, targetUserId, action });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to list audit log', err);
    res.status(500).json({ error: 'Failed to list audit log' });
  }
});

// ---------------------------------------------------------------------------
// API Limits
// ---------------------------------------------------------------------------

router.get('/api-limits', async (_req, res) => {
  try {
    const config = getApiLimitsConfig();
    const [usage, budgets] = await Promise.all([getApiUsageSummary(), getApiBudgetSummary()]);
    const providers = Object.entries(config.providers).map(([provider, providerConfig]) => ({
      budgetingModels: Object.entries(getApiBudgetProviderConfig(provider)?.models ?? {}).map(([model, pricing]) => ({
        model,
        inputCostPer1MTokensUsd: pricing.inputCostPer1MTokensUsd,
        outputCostPer1MTokensUsd: pricing.outputCostPer1MTokensUsd,
      })),
      provider,
      window: providerConfig.window ?? 'day',
      windowHours: providerConfig.windowHours ?? 1,
      overallLimit: providerConfig.overall ?? null,
      monthlyBudgetUsd: budgets.find((entry) => entry.provider === provider)?.monthlyBudgetUsd ?? null,
      estimatedSpendUsd: budgets.find((entry) => entry.provider === provider)?.estimatedSpendUsd ?? 0,
      budgetWindowKey: budgets.find((entry) => entry.provider === provider)?.windowKey ?? null,
      budgetUsagePercent: budgets.find((entry) => entry.provider === provider)?.budgetUsagePercent ?? null,
      budgetAlertThresholdPercent: budgets.find((entry) => entry.provider === provider)?.alertThresholdPercent ?? null,
      isBudgetExceeded: budgets.find((entry) => entry.provider === provider)?.isOverBudget ?? false,
      callers: Object.entries(providerConfig.callers).map(([caller, limit]) => ({
        caller,
        limit,
        currentUsage: usage.find((u) => u.provider === provider && u.caller === caller)?.used ?? 0,
      })),
      overallUsage: usage.find((u) => u.provider === provider && u.scope === 'overall')?.used ?? 0,
    }));
    res.json({ providers, caching: config.caching });
  } catch (err) {
    logError('[admin] failed to get api limits', err);
    res.status(500).json({ error: 'Failed to get API limits' });
  }
});

router.patch('/api-limits/:provider', async (req, res) => {
  const { provider } = req.params;
  const { window, windowHours, overallLimit, callers, monthlyBudgetUsd, alertThresholdPercent, budgetingModels, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (window !== 'hour' && window !== 'day') {
    res.status(400).json({ error: 'window must be "hour" or "day"' });
    return;
  }
  if (typeof windowHours !== 'number' || !Number.isFinite(windowHours) || windowHours <= 0) {
    res.status(400).json({ error: 'windowHours must be a positive number' });
    return;
  }
  if (overallLimit !== null && (typeof overallLimit !== 'number' || !Number.isFinite(overallLimit) || overallLimit <= 0)) {
    res.status(400).json({ error: 'overallLimit must be null or a positive number' });
    return;
  }
  if (typeof callers !== 'object' || callers === null || Array.isArray(callers)) {
    res.status(400).json({ error: 'callers must be an object of positive numeric limits' });
    return;
  }
  if (
    monthlyBudgetUsd !== null &&
    typeof monthlyBudgetUsd !== 'undefined' &&
    (!Number.isFinite(Number(monthlyBudgetUsd)) || Number(monthlyBudgetUsd) <= 0)
  ) {
    res.status(400).json({ error: 'monthlyBudgetUsd must be null or a positive number' });
    return;
  }
  if (
    alertThresholdPercent !== null &&
    typeof alertThresholdPercent !== 'undefined' &&
    (!Number.isFinite(Number(alertThresholdPercent)) || Number(alertThresholdPercent) <= 0 || Number(alertThresholdPercent) > 100)
  ) {
    res.status(400).json({ error: 'alertThresholdPercent must be null or a number between 0 and 100' });
    return;
  }
  if (
    typeof budgetingModels !== 'undefined' &&
    (typeof budgetingModels !== 'object' || budgetingModels === null || Array.isArray(budgetingModels))
  ) {
    res.status(400).json({ error: 'budgetingModels must be an object keyed by model name' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const config = getApiLimitsConfig();
    const normalizedProvider = normalizeApiLimitKeyPart(provider);
    const currentProvider = config.providers[normalizedProvider];
    if (!currentProvider) {
      res.status(404).json({ error: `API provider not found: ${provider}` });
      return;
    }

    const normalizedCallers = Object.fromEntries(
      Object.entries(callers as Record<string, unknown>).map(([callerKey, rawLimit]) => [
        normalizeApiLimitKeyPart(callerKey),
        Number(rawLimit),
      ])
    );
    const unknownCallers = Object.keys(normalizedCallers).filter((callerKey) => !(callerKey in currentProvider.callers));
    if (unknownCallers.length > 0) {
      res.status(400).json({ error: `Unknown caller limits: ${unknownCallers.join(', ')}` });
      return;
    }
    const invalidCallers = Object.entries(normalizedCallers).filter(([, limit]) => !Number.isFinite(limit) || limit <= 0);
    if (invalidCallers.length > 0) {
      res.status(400).json({ error: 'All caller limits must be positive numbers' });
      return;
    }
    const currentBudgeting = getApiBudgetProviderConfig(normalizedProvider);
    const normalizedBudgetingModels = Object.fromEntries(
      Object.entries((budgetingModels as Record<string, any> | undefined) ?? {}).map(([modelKey, rawPricing]) => [
        normalizeApiLimitKeyPart(modelKey),
        {
          inputCostPer1MTokensUsd: Number(rawPricing?.inputCostPer1MTokensUsd),
          outputCostPer1MTokensUsd: Number(rawPricing?.outputCostPer1MTokensUsd),
        },
      ])
    );
    const mergedBudgetingModels = Object.fromEntries(
      Object.entries(currentBudgeting?.models ?? {}).map(([modelKey, pricing]) => [
        modelKey,
        {
          inputCostPer1MTokensUsd:
            normalizedBudgetingModels[modelKey]?.inputCostPer1MTokensUsd ?? pricing.inputCostPer1MTokensUsd,
          outputCostPer1MTokensUsd:
            normalizedBudgetingModels[modelKey]?.outputCostPer1MTokensUsd ?? pricing.outputCostPer1MTokensUsd,
        },
      ])
    );
    for (const [modelKey, pricing] of Object.entries(normalizedBudgetingModels)) {
      if (!(modelKey in mergedBudgetingModels)) {
        mergedBudgetingModels[modelKey] = pricing;
      }
    }
    const invalidBudgetingModel = Object.entries(mergedBudgetingModels).find(
      ([, pricing]) =>
        !Number.isFinite(pricing.inputCostPer1MTokensUsd) ||
        pricing.inputCostPer1MTokensUsd <= 0 ||
        !Number.isFinite(pricing.outputCostPer1MTokensUsd) ||
        pricing.outputCostPer1MTokensUsd <= 0
    );
    if (invalidBudgetingModel) {
      res.status(400).json({ error: `All model pricing values must be positive numbers (${invalidBudgetingModel[0]})` });
      return;
    }

    const nextProvider = {
      window,
      windowHours: Math.floor(windowHours),
      overall: overallLimit === null ? null : Math.floor(overallLimit),
      callers: Object.fromEntries(
        Object.keys(currentProvider.callers).map((callerKey) => [
          callerKey,
          Math.floor(normalizedCallers[callerKey] ?? currentProvider.callers[callerKey]),
        ])
      ),
    };
    const nextBudgeting = {
      monthlyBudgetUsd:
        monthlyBudgetUsd === null
          ? null
          : typeof monthlyBudgetUsd === 'undefined'
            ? (currentBudgeting?.monthlyBudgetUsd ?? null)
            : Number(monthlyBudgetUsd),
      alertThresholdPercent:
        alertThresholdPercent === null
          ? null
          : typeof alertThresholdPercent === 'undefined'
            ? (currentBudgeting?.alertThresholdPercent ?? null)
            : Number(alertThresholdPercent),
      models: mergedBudgetingModels,
    };

    updateApiLimitProviderConfig(normalizedProvider, nextProvider);
    updateApiBudgetProviderConfig(normalizedProvider, nextBudgeting);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'API_LIMITS_UPDATED',
      beforeState: {
        provider: normalizedProvider,
        window: currentProvider.window ?? 'day',
        windowHours: currentProvider.windowHours ?? 1,
        overallLimit: currentProvider.overall ?? null,
        callers: currentProvider.callers,
        budgeting: {
          monthlyBudgetUsd: currentBudgeting?.monthlyBudgetUsd ?? null,
          alertThresholdPercent: currentBudgeting?.alertThresholdPercent ?? null,
          models: currentBudgeting?.models ?? {},
        },
      },
      afterState: {
        provider: normalizedProvider,
        window: nextProvider.window,
        windowHours: nextProvider.windowHours,
        overallLimit: nextProvider.overall,
        callers: nextProvider.callers,
        budgeting: nextBudgeting,
      },
      reason: reasonStr,
    });

    res.json({
      provider: normalizedProvider,
      window: nextProvider.window,
      windowHours: nextProvider.windowHours,
      overallLimit: nextProvider.overall,
      callers: nextProvider.callers,
      monthlyBudgetUsd: nextBudgeting.monthlyBudgetUsd,
      alertThresholdPercent: nextBudgeting.alertThresholdPercent,
      budgetingModels: nextBudgeting.models,
    });
  } catch (err) {
    logError('[admin] failed to update api limits', err);
    res.status(500).json({ error: 'Failed to update API limits' });
  }
});

export default router;
