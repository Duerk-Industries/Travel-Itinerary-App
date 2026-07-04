import { Router } from 'express';
import bodyParser from 'body-parser';
import {
  listFeatureFlags, setFeatureFlag, writeAuditLog,
  listAiProviderConfigs,
  listTiers, getTierByKey, listTierLimits, listTierEntitlements, listFeatures,
  upsertTierLimit, upsertTierEntitlement,
  getUserRole, setUserRole, setUserTier, getCurrentUserTier,
  listAuditLog,
  adminSearchUsers, adminGetUser, adminGetUserData,
  getUniversalPackingList, replaceUniversalPackingList,
} from '../db';
import { TokenPayload } from '../auth';
import { logError } from '../logger';
import { getEnvValue } from '../env';
import { getRegisteredAiProviders } from '../ai/registry/aiProviderRegistry';
import {
  clearAiProviderConfigCache,
  setAiProviderConfigWithAudit,
} from '../services/aiProviderConfigService';
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
import {
  countImportJobsByState,
  listDataDeletionJobs,
  type DataDeletionJobState,
} from '../ingestion/shared/repository';
import { readDto } from '../utils/dtoParse';
import { bulkSetUserTierDto, bulkSetUserRoleDto } from './adminDtos';
import { getMetricCounterSnapshot } from '../metrics';

// Admin routes — all guarded by authenticate + requireAdmin in app.ts
const router = Router();
router.use(bodyParser.json());

const getActorId = (req: any): string => (req.user as TokenPayload).userId;

const requireReason = (reason: unknown): string | null => {
  if (typeof reason !== 'string' || reason.trim().length < 3) return null;
  return reason.trim();
};

const AI_FEATURE_KEYS = ['itinerary_generation', 'ingestion_llm_extract'] as const;
const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  zai: 'ZAI_API_KEY',
};

const getAiProviderOptions = () => {
  const registered = new Set(getRegisteredAiProviders().map((provider) => provider.id));
  for (const id of Object.keys(PROVIDER_ENV_KEYS)) registered.add(id);
  return Array.from(registered)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      configured: Boolean(getEnvValue(PROVIDER_ENV_KEYS[id] ?? `${id.toUpperCase()}_API_KEY`)),
      registered: getRegisteredAiProviders().some((provider) => provider.id === id),
      supportedModels: getRegisteredAiProviders().find((provider) => provider.id === id)?.supportedModels ?? [],
    }));
};

// ---------------------------------------------------------------------------
// AI provider config
// ---------------------------------------------------------------------------

router.get('/ai-config', async (_req, res) => {
  try {
    const stored = await listAiProviderConfigs();
    const byFeature = new Map(stored.map((row) => [row.featureKey, row]));
    const now = new Date().toISOString();
    const features = AI_FEATURE_KEYS.map((featureKey) => {
      const row = byFeature.get(featureKey);
      return row ?? {
        featureKey,
        provider: 'openai',
        model: 'gpt-4o-mini',
        enabled: true,
        updatedBy: null,
        updatedAt: now,
        source: 'default',
      };
    });
    res.json({ features, providers: getAiProviderOptions() });
  } catch (err) {
    logError('[admin] failed to list AI provider config', err);
    res.status(500).json({ error: 'Failed to list AI provider config' });
  }
});

router.patch('/ai-config/:featureKey', async (req, res) => {
  const featureKey = String(req.params.featureKey ?? '').trim();
  const { provider, model, enabled, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!AI_FEATURE_KEYS.includes(featureKey as any)) {
    res.status(404).json({ error: `Unknown AI feature key: ${featureKey}` });
    return;
  }
  if (typeof provider !== 'string' || !provider.trim()) {
    res.status(400).json({ error: 'provider is required' });
    return;
  }
  if (typeof model !== 'string' || !model.trim()) {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled boolean is required' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  const providerId = provider.trim().toLowerCase();
  const providerOption = getAiProviderOptions().find((item) => item.id === providerId);
  if (!providerOption?.configured || !providerOption.registered) {
    res.status(400).json({ error: `Provider is not configured or registered: ${providerId}` });
    return;
  }
  try {
    const actorId = getActorId(req);
    const updated = await setAiProviderConfigWithAudit({
      featureKey,
      provider: providerId,
      model: model.trim(),
      enabled,
      actorUserId: actorId,
      reason: reasonStr,
    });
    clearAiProviderConfigCache(featureKey);
    res.json({ config: updated, providers: getAiProviderOptions() });
  } catch (err) {
    logError('[admin] failed to update AI provider config', err);
    res.status(500).json({ error: 'Failed to update AI provider config' });
  }
});

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

router.get('/packing-list-defaults', async (_req, res) => {
  try {
    const items = await getUniversalPackingList();
    res.json({ items });
  } catch (err) {
    logError('[admin] failed to list packing defaults', err);
    res.status(500).json({ error: 'Failed to list packing defaults' });
  }
});

router.put('/packing-list-defaults', async (req, res) => {
  try {
    const items = await replaceUniversalPackingList(Array.isArray(req.body?.items) ? req.body.items : []);
    await writeAuditLog({
      actorUserId: getActorId(req),
      action: 'PACKING_DEFAULTS_UPDATED',
      afterState: { packingListDefaultsCount: items.length },
      reason: typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Updated universal packing list defaults',
    });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
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

/**
 * Bulk set the tier for up to 100 users in a single request. Mirrors the
 * ingestion bulk-action convention: per-id try/catch, dedupe + empty-id strip
 * in the DTO, and 207 Multi-Status when any id fails so partial success is
 * first-class. Admin-role targets are resolved to 'pro' server-side (matching
 * the single-user PATCH); this is surfaced in the response as `lockedToPro`
 * and does not count as a failure.
 */
router.post('/users/bulk-tier', async (req, res) => {
  const dto = readDto(bulkSetUserTierDto, req.body, res);
  if (!dto) return;
  const actorId = getActorId(req);
  const tierKey = dto.tierKey;
  const reason = dto.reason;

  const updated: Array<{ id: string; tierKey: string; lockedToPro: boolean }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const targetId of dto.ids) {
    try {
      const targetUser = await adminGetUser(targetId);
      if (!targetUser) {
        failed.push({ id: targetId, reason: 'User not found' });
        continue;
      }
      const resolvedTierKey = targetUser.role === 'admin' ? 'pro' : tierKey;
      const before = await getCurrentUserTier(targetId);
      await setUserTier(targetId, resolvedTierKey, 'admin', actorId, reason);
      const after = await getCurrentUserTier(targetId);
      await writeAuditLog({
        actorUserId: actorId,
        targetUserId: targetId,
        action: 'USER_TIER_CHANGED',
        beforeState: { tierKey: before?.tierKey ?? null, requestedTierKey: tierKey },
        afterState: { tierKey: after?.tierKey ?? null, bulk: true },
        reason,
      });
      updated.push({
        id: targetId,
        tierKey: after?.tierKey ?? resolvedTierKey,
        lockedToPro: targetUser.role === 'admin',
      });
    } catch (err: any) {
      const message = String(err?.message ?? 'Tier change failed');
      logError('[admin] bulk tier change: per-id failure', { targetId, err: message });
      failed.push({ id: targetId, reason: message });
    }
  }

  res.status(failed.length > 0 ? 207 : 200).json({ updated, failed });
});

/**
 * Bulk change the role for up to 100 users. Mirrors the bulk-tier pattern
 * (100-id cap, per-id try/catch, 207 Multi-Status when any id fails, per-id
 * audit log entries). Critical guardrail: the acting admin cannot demote
 * THEIR OWN account in a bulk update — self-demotion would lock an admin
 * out of follow-up recovery. That single id is surfaced in `failed` with a
 * clear reason; the rest of the batch still proceeds.
 *
 * Granting admin also auto-assigns Pro tier (parity with the single-user
 * PATCH at `/users/:userId/role`). The tier change writes its own audit
 * entry via `setUserTier`.
 */
router.post('/users/bulk-role', async (req, res) => {
  const dto = readDto(bulkSetUserRoleDto, req.body, res);
  if (!dto) return;
  const actorId = getActorId(req);
  const role = dto.role;
  const reason = dto.reason;

  const updated: Array<{ id: string; role: 'admin' | 'user'; previousRole: string | null }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const targetId of dto.ids) {
    try {
      if (actorId === targetId && role !== 'admin') {
        failed.push({ id: targetId, reason: 'Admins cannot revoke their own admin role' });
        continue;
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
        afterState: { role, bulk: true },
        reason,
      });
      updated.push({ id: targetId, role, previousRole });
    } catch (err: any) {
      const message = String(err?.message ?? 'Role change failed');
      logError('[admin] bulk role change: per-id failure', { targetId, err: message });
      failed.push({ id: targetId, reason: message });
    }
  }

  res.status(failed.length > 0 ? 207 : 200).json({ updated, failed });
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

// ---------------------------------------------------------------------------
// Metrics snapshot (in-process counters + cache hit-rate)
// ---------------------------------------------------------------------------

router.get('/metrics', (_req, res) => {
  // Per-instance best-effort aggregation — if the deployment has multiple
  // instances each returns its own counters. Client should label accordingly.
  res.json(getMetricCounterSnapshot());
});

// ---------------------------------------------------------------------------
// Ingestion queue depth — import_jobs grouped by state (live, not a cache)
// ---------------------------------------------------------------------------

/**
 * Returns `{ countsByState: { PENDING: N, PROCESSING: N, FAILED: N, ... },
 * totalActive: N, totalTerminal: N, snapshotAtIso }`. Powers the AdminTab
 * queue-depth card and gives operators an at-a-glance view of how many
 * imports are stuck in retriable vs terminal states without having to shell
 * into Prometheus.
 */
router.get('/ingestion-queue-depth', async (_req, res) => {
  try {
    const countsByState = await countImportJobsByState();
    const ACTIVE = new Set(['PENDING', 'QUEUED', 'NORMALIZING', 'PARSING', 'AWAITING_REVIEW', 'PROCESSING']);
    const TERMINAL = new Set(['COMPLETED', 'DEAD_LETTERED', 'CANCELLED']);
    let totalActive = 0;
    let totalTerminal = 0;
    for (const [state, count] of Object.entries(countsByState)) {
      if (ACTIVE.has(state)) totalActive += count;
      else if (TERMINAL.has(state)) totalTerminal += count;
    }
    res.json({
      countsByState,
      totalActive,
      totalTerminal,
      failedRetriable: countsByState.FAILED ?? 0,
      snapshotAtIso: new Date().toISOString(),
    });
  } catch (err) {
    logError('[admin] failed to compute ingestion queue depth', err);
    res.status(500).json({ error: 'Failed to compute queue depth' });
  }
});

// ---------------------------------------------------------------------------
// Data deletion jobs (Gmail/ingestion provider disconnect observability)
// ---------------------------------------------------------------------------

const VALID_DELETION_STATES: readonly DataDeletionJobState[] = ['pending', 'running', 'succeeded', 'failed'];

router.get('/data-deletion-jobs', async (req, res) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  const state = stateParam && VALID_DELETION_STATES.includes(stateParam as DataDeletionJobState)
    ? (stateParam as DataDeletionJobState)
    : undefined;
  if (stateParam && !state) {
    res.status(400).json({ error: `state must be one of: ${VALID_DELETION_STATES.join(', ')}` });
    return;
  }
  const userId = typeof req.query.userId === 'string' && req.query.userId.trim() ? req.query.userId.trim() : undefined;
  const limitParam = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
  const limit = Number.isFinite(limitParam) && (limitParam as number) > 0 ? (limitParam as number) : undefined;
  try {
    const jobs = await listDataDeletionJobs({ state, userId, limit });
    res.json({ jobs });
  } catch (err) {
    logError('[admin] failed to list data deletion jobs', err);
    res.status(500).json({ error: 'Failed to list data deletion jobs' });
  }
});

export default router;
