import {
  getUserRole, setUserRole, writeAuditLog,
  getFeatureFlag, listFeatureFlags, setFeatureFlag,
  getCurrentUserTier, listTiers, getTierLimitValue, setUserTier,
  listFeatures, listTierEntitlements, upsertTierEntitlement,
  incrementUsageCounter, countActiveTripsForUser, countGroupMembers,
  appendUsageEvent,
  ensureCurrentUserTier, reserveGenerationIdempotency, getGenerationIdempotency,
  completeGenerationIdempotency, failGenerationIdempotency, countReservedOrCompletedUsage,
  getAdminSetting, setAdminSetting,
} from '../db';
import { UserRole, TierKey } from '../types';
import { logInfo, logError } from '../logger';
import { incrementMetric } from '../metrics';
import { getEnvValue } from '../env';
import { getFeatureFlagSeeds } from '../config/featureFlags';
import { EntitlementError } from '../errors';

const ADMIN_BOOTSTRAP_EMAILS = ['bryan.duerk@gmail.com', 'tristan.duerk@gmail.com'];
const SEEDED_TIER_BY_EMAIL: Record<string, TierKey> = {
  'vduerk@gmail.com': 'premium',
  'jobs.duerk@gmail.com': 'free',
};
const ADMIN_DEFAULT_TIER: TierKey = 'pro';

export const getSeededTierForEmail = (email: string | null | undefined): TierKey => {
  const normalized = String(email ?? '').trim().toLowerCase();
  return SEEDED_TIER_BY_EMAIL[normalized] ?? 'free';
};

/**
 * Called at every auth success path. Grants admin role on first login for bootstrap email addresses.
 * Idempotent: safe to call repeatedly; audit event written only on first grant.
 */
export const ensureAdminBootstrap = async (userId: string, email: string): Promise<void> => {
  const normalized = email.trim().toLowerCase();
  if (!ADMIN_BOOTSTRAP_EMAILS.includes(normalized)) return;

  const currentRole = await getUserRole(userId);
  if (currentRole !== 'admin') {
    await setUserRole(userId, 'admin');
    await writeAuditLog({
      actorUserId: null,
      targetUserId: userId,
      action: 'ADMIN_BOOTSTRAP_GRANTED',
      afterState: { email: normalized, role: 'admin' },
      reason: 'Automatic bootstrap grant on first login',
    });
    logInfo(`[entitlement] Admin bootstrap granted to ${normalized}`);
  }

  const currentTier = await getCurrentUserTier(userId);
  if (currentTier?.tierKey !== ADMIN_DEFAULT_TIER) {
    await setUserTier(userId, ADMIN_DEFAULT_TIER, 'system', null, 'Admin users are automatically assigned Pro tier');
  }
};

/**
 * Returns the user's current role from the database.
 * Used at token issuance to ensure JWT carries a fresh role.
 */
export const getUserRoleForToken = async (userId: string): Promise<UserRole> => {
  return getUserRole(userId);
};

/**
 * Seeds feature flags from the YAML config file into the database.
 * Only inserts flags that do not already exist — existing DB values are never overwritten.
 * Called once at startup after initDb().
 */
export const seedEntitlementDefaults = async (): Promise<void> => {
  const seeds = getFeatureFlagSeeds();
  if (Object.keys(seeds).length === 0) return;

  const existing = await listFeatureFlags();
  const existingKeys = new Set(existing.map(f => f.key));

  for (const [key, seed] of Object.entries(seeds)) {
    if (!existingKeys.has(key)) {
      await setFeatureFlag(key, seed.enabled, null);
      logInfo(`[entitlement] Seeded feature flag: ${key} = ${seed.enabled}`);
    }
  }

  const tiers = await listTiers();
  const features = await listFeatures();
  const tierByKey = new Map(tiers.map((tier) => [tier.key, tier]));
  const featureByKey = new Map(features.map((feature) => [feature.key, feature]));
  const entitlementSeeds: Array<[TierKey, string, boolean]> = [
    ['free', 'ai_itinerary_generation', true],
    ['free', 'csv_export', true],
    ['free', 'car_rentals', true],
    ['free', 'trip_sharing', true],
    ['free', 'trip_following', true],
    ['free', 'cost_tracking', false],
    ['free', 'multiple_groups', true],
    ['free', 'trip_creation', true],
    ['free', 'flight_parser', false],
    ['premium', 'cost_tracking', true],
    ['premium', 'flight_parser', true],
    ['pro', 'cost_tracking', true],
    ['pro', 'flight_parser', true],
  ];
  for (const [tierKey, featureKey, isAllowed] of entitlementSeeds) {
    const tier = tierByKey.get(tierKey);
    const feature = featureByKey.get(featureKey);
    if (!tier || !feature) continue;
    await upsertTierEntitlement(tier.id, feature.id, isAllowed);
  }

  for (const [key, value] of [
    ['shadow_parse_sample_rate_percent', '10'],
    ['shadow_parse_monthly_budget_usd', '20'],
  ] as const) {
    if (!(await getAdminSetting(key))) {
      await setAdminSetting({ key, value, updatedBy: null });
    }
  }
};

const parseStartupFeatureFlagOverrides = (): string[] => {
  const raw = getEnvValue('STARTUP_FORCE_ENABLE_FEATURE_FLAGS', { defaultValue: '' }) || '';
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

export const applyStartupFeatureFlagOverrides = async (): Promise<void> => {
  const flagsToEnable = parseStartupFeatureFlagOverrides();
  if (flagsToEnable.length === 0) {
    return;
  }

  for (const key of flagsToEnable) {
    const current = await getFeatureFlag(key);
    if (current?.enabled) {
      logInfo(`[entitlement] Startup feature flag already enabled: ${key}`);
      continue;
    }
    await setFeatureFlag(key, true, null);
    logInfo(`[entitlement] Startup feature flag override enabled: ${key}`);
  }
};

// ---------------------------------------------------------------------------
// Feature flag checks
// ---------------------------------------------------------------------------

// Simple 60-second in-process cache — DB is authoritative, cache reduces per-request load.
const flagCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const FLAG_CACHE_TTL_MS = 60_000;

/**
 * Returns whether a feature flag is enabled.
 * Checks DB with a 60-second in-process TTL cache.
 * Returns true for unknown flags (fail-open) — a missing row means not explicitly disabled.
 */
export const isFeatureEnabled = async (key: string): Promise<boolean> => {
  const cached = flagCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.enabled;
  }
  const flag = await getFeatureFlag(key);
  const enabled = flag?.enabled ?? true;
  flagCache.set(key, { enabled, expiresAt: Date.now() + FLAG_CACHE_TTL_MS });
  return enabled;
};

export const clearFeatureFlagCacheForTesting = (): void => {
  if (process.env.NODE_ENV === 'test') {
    flagCache.clear();
  }
};

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

/**
 * Returns the active tier key for a user. Defaults to 'free' if no row exists.
 */
export const getUserTierKey = async (userId: string): Promise<TierKey> => {
  await ensureCurrentUserTier(userId, 'free');
  const userTier = await getCurrentUserTier(userId);
  return (userTier?.tierKey ?? 'free') as TierKey;
};

// ---------------------------------------------------------------------------
// Limit resolution — rank-based inheritance
// ---------------------------------------------------------------------------

// Tier data rarely changes; cache the full list for 5 minutes.
let tiersCache: { tiers: Awaited<ReturnType<typeof listTiers>>; expiresAt: number } | null = null;
const TIERS_CACHE_TTL_MS = 5 * 60_000;

const getCachedTiers = async () => {
  if (tiersCache && Date.now() < tiersCache.expiresAt) return tiersCache.tiers;
  const tiers = await listTiers();
  tiersCache = { tiers, expiresAt: Date.now() + TIERS_CACHE_TTL_MS };
  return tiers;
};

/**
 * Resolves the effective limit value for a user and limit key using tier rank inheritance.
 * Walks from the user's tier rank down to rank 1, returning the first explicit row found.
 * Returns -1 for unlimited, null if no limit row exists anywhere in the inheritance chain.
 */
export const getEffectiveLimit = async (userId: string, limitKey: string): Promise<number | null> => {
  await ensureCurrentUserTier(userId, 'free');
  const userTier = await getCurrentUserTier(userId);
  if (!userTier) return null;

  const allTiers = await getCachedTiers();
  const userTierRank = allTiers.find(t => t.id === userTier.tierId)?.rank ?? 0;

  // Walk from user's rank down to lowest rank (highest rank = most permissive)
  const eligibleTiers = allTiers
    .filter(t => t.rank <= userTierRank)
    .sort((a, b) => b.rank - a.rank);

  for (const tier of eligibleTiers) {
    const value = await getTierLimitValue(tier.id, limitKey);
    if (value !== null) return value;
  }
  return null;
};

export const getLimit = async (userId: string, limitKey: string): Promise<number | null> => {
  const limit = await getEffectiveLimit(userId, limitKey);
  return limit === -1 ? Number.POSITIVE_INFINITY : limit;
};

// ---------------------------------------------------------------------------
// Tier entitlement checks
// ---------------------------------------------------------------------------

// Cache feature list (features table) for 5 minutes — stable data.
let featuresCache: { features: Awaited<ReturnType<typeof listFeatures>>; expiresAt: number } | null = null;
const FEATURES_CACHE_TTL_MS = 5 * 60_000;

const getCachedFeatures = async () => {
  if (featuresCache && Date.now() < featuresCache.expiresAt) return featuresCache.features;
  const features = await listFeatures();
  featuresCache = { features, expiresAt: Date.now() + FEATURES_CACHE_TTL_MS };
  return featuresCache.features;
};

/**
 * Returns whether a user is entitled to use a feature based on their tier.
 * Checks both the feature flag (deployment toggle) and tier entitlement.
 *
 * - Feature flag: admin is NOT exempt — if the flag is off, nobody uses it.
 * - Tier entitlement: admin bypasses (always allowed when flag is on).
 *
 * Throws EntitlementError on denial; returns void on success.
 */
export const assertCanUseFeature = async (
  userId: string,
  featureKey: string,
  role: UserRole
): Promise<void> => {
  // 1. Feature flag — no bypass, even for admins.
  const flagEnabled = await isFeatureEnabled(featureKey);
  if (!flagEnabled) {
    incrementMetric('feature_access_denied', { featureKey, reason: 'flag_disabled' });
    throw new EntitlementError('FEATURE_DISABLED', `Feature '${featureKey}' is currently disabled`, { featureKey });
  }

  // 2. Tier entitlement — admin bypasses.
  if (role === 'admin') return;

  const features = await getCachedFeatures();
  const feature = features.find(f => f.key === featureKey);
  if (!feature) {
    // Unknown feature key — fail-open. No explicit deny configured means allowed.
    return;
  }

  await ensureCurrentUserTier(userId, 'free');
  const userTier = await getCurrentUserTier(userId);
  if (!userTier) return; // No tier row — treat as free; if free has no explicit deny, allow by default.

  const allTiers = await getCachedTiers();
  const userTierRank = allTiers.find(t => t.id === userTier.tierId)?.rank ?? 0;
  const eligibleTiers = allTiers
    .filter((tier) => tier.rank <= userTierRank)
    .sort((a, b) => b.rank - a.rank);
  let resolvedAllowance: boolean | null = null;
  for (const tier of eligibleTiers) {
    const entitlements = await listTierEntitlements(tier.id);
    const entry = entitlements.find((item) => item.featureId === feature.id);
    if (entry) {
      resolvedAllowance = entry.isAllowed;
      break;
    }
  }

  if (resolvedAllowance === false) {
    incrementMetric('feature_access_denied', { featureKey, reason: 'tier_not_entitled' });
    throw new EntitlementError(
      'FEATURE_NOT_ENTITLED',
      `Your current plan does not include access to '${featureKey}'`,
      { featureKey }
    );
  }
};

export const canUseFeature = async (userId: string, featureKey: string, role: UserRole = 'user'): Promise<boolean> => {
  try {
    await assertCanUseFeature(userId, featureKey, role);
    return true;
  } catch (err) {
    if (err instanceof EntitlementError) return false;
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Active trip limit
// ---------------------------------------------------------------------------

/**
 * Checks whether a user can create a new active trip.
 * Admin bypasses the trip count limit.
 * Throws EntitlementError if the limit is reached.
 */
export const assertUnderActiveTripLimit = async (userId: string, role: UserRole): Promise<void> => {
  if (role === 'admin') return;

  const limit = await getEffectiveLimit(userId, 'max_active_trips');
  if (limit === null || limit === -1) return; // No limit or unlimited

  const current = await countActiveTripsForUser(userId);
  if (current >= limit) {
    throw new EntitlementError(
      'TIER_LIMIT_REACHED',
      `You have reached the active trip limit of ${limit} for your current plan`,
      { limitKey: 'max_active_trips' }
    );
  }
};

// ---------------------------------------------------------------------------
// Traveler limit
// ---------------------------------------------------------------------------

/**
 * Checks whether a user can add another member to a group (trip traveler limit).
 * Admin bypasses the check.
 * Throws EntitlementError if the limit is reached.
 */
export const assertUnderTravelerLimit = async (userId: string, groupId: string, role: UserRole): Promise<void> => {
  if (role === 'admin') return;

  const limit = await getEffectiveLimit(userId, 'max_travelers_per_trip');
  if (limit === null || limit === -1) return; // No limit or unlimited

  const current = await countGroupMembers(groupId);
  if (current >= limit) {
    throw new EntitlementError(
      'TIER_LIMIT_REACHED',
      `You have reached the traveler limit of ${limit} for your current plan`,
      { limitKey: 'max_travelers_per_trip' }
    );
  }
};

// ---------------------------------------------------------------------------
// AI generation counter
// ---------------------------------------------------------------------------

/**
 * Atomically increments the AI generation counter for a user within a billing window.
 * Admin bypasses the limit check (counter is still incremented for observability).
 * Throws EntitlementError if the limit is reached (non-admin only).
 *
 * @param userId      User performing the generation
 * @param windowKey   UTC billing window key, e.g. "2026-03"
 * @param role        User role — admin bypasses limit
 */
export const assertAndIncrementGenerationCount = async (
  userId: string,
  windowKey: string,
  role: UserRole
): Promise<void> => {
  const limit = await getEffectiveLimit(userId, 'ai_itinerary_generations_per_month');
  if (role === 'admin' || limit === null || limit === -1) return;
  const current = await countReservedOrCompletedUsage(userId, 'ai_itinerary_generations', windowKey);
  if (current > limit) {
    throw new EntitlementError(
      'TIER_LIMIT_REACHED',
      `You have reached the AI itinerary generation limit of ${limit} for this month`,
      { limitKey: 'ai_itinerary_generations_per_month' }
    );
  }
};

export const recordUsage = async (
  userId: string,
  usageKey: string,
  amount = 1,
  metadata?: { windowKey?: string | null; [key: string]: unknown }
): Promise<void> => {
  const windowKey = metadata?.windowKey ?? 'all-time';
  await incrementUsageCounter(userId, usageKey, windowKey, amount);
  if (windowKey !== 'all-time') {
    await incrementUsageCounter(userId, usageKey, 'all-time', amount);
  }
  await appendUsageEvent(userId, usageKey, amount, metadata ?? null);
};

export const reserveGenerationUsage = async (params: {
  userId: string;
  tripId: string;
  role: UserRole;
  windowKey: string;
  idempotencyKey: string;
}): Promise<
  | { status: 'reserved'; key: string }
  | { status: 'completed'; responseBody: Record<string, unknown> | null }
  | { status: 'pending' }
> => {
  const existing = await getGenerationIdempotency(params.idempotencyKey);
  if (existing?.userId === params.userId) {
    if (existing.status === 'completed') {
      return { status: 'completed', responseBody: existing.responseBody ?? null };
    }
    if (existing.status === 'pending') {
      return { status: 'pending' };
    }
  }
  const reservation = await reserveGenerationIdempotency({
    key: params.idempotencyKey,
    userId: params.userId,
    tripId: params.tripId,
    usageKey: 'ai_itinerary_generations',
    windowKey: params.windowKey,
    ttlSeconds: 3600,
  });
  if (!reservation.created) {
    const current = reservation.record;
    if (current?.userId === params.userId && current.status === 'completed') {
      return { status: 'completed', responseBody: current.responseBody ?? null };
    }
    return { status: 'pending' };
  }
  try {
    await assertAndIncrementGenerationCount(params.userId, params.windowKey, params.role);
  } catch (err) {
    await failGenerationUsage(params.idempotencyKey, (err as Error).message);
    throw err;
  }
  return { status: 'reserved', key: params.idempotencyKey };
};

export const finalizeGenerationUsage = async (params: {
  userId: string;
  windowKey: string;
  idempotencyKey: string;
  responseBody: Record<string, unknown>;
}): Promise<void> => {
  await completeGenerationIdempotency(params.idempotencyKey, params.responseBody);
  await recordUsage(params.userId, 'ai_itinerary_generations', 1, { windowKey: params.windowKey });
};

export const failGenerationUsage = async (idempotencyKey: string, errorMessage: string): Promise<void> => {
  try {
    await failGenerationIdempotency(idempotencyKey, errorMessage);
  } catch (err) {
    logError('[entitlement] Failed to mark generation reservation as failed', err);
  }
};
