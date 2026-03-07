import {
  getUserRole, setUserRole, writeAuditLog,
  getFeatureFlag, listFeatureFlags, setFeatureFlag,
  getCurrentUserTier, listTiers, getTierLimitValue,
  listFeatures, listTierEntitlements,
  atomicIncrementIfUnderLimit, incrementUsageCounter, countActiveTripsForUser, countGroupMembers,
} from '../db';
import { UserRole, TierKey } from '../types';
import { logInfo, logError } from '../logger';
import { getFeatureFlagSeeds } from '../config/featureFlags';
import { EntitlementError } from '../errors';

const ADMIN_BOOTSTRAP_EMAILS = ['bryan.duerk@gmail.com', 'tristan.duerk@gmail.com'];

/**
 * Called at every auth success path. Grants admin role on first login for bootstrap email addresses.
 * Idempotent: safe to call repeatedly; audit event written only on first grant.
 */
export const ensureAdminBootstrap = async (userId: string, email: string): Promise<void> => {
  const normalized = email.trim().toLowerCase();
  if (!ADMIN_BOOTSTRAP_EMAILS.includes(normalized)) return;

  const currentRole = await getUserRole(userId);
  if (currentRole === 'admin') return;

  await setUserRole(userId, 'admin');
  await writeAuditLog({
    actorUserId: null,
    targetUserId: userId,
    action: 'ADMIN_BOOTSTRAP_GRANTED',
    afterState: { email: normalized, role: 'admin' },
    reason: 'Automatic bootstrap grant on first login',
  });
  logInfo(`[entitlement] Admin bootstrap granted to ${normalized}`);
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

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

/**
 * Returns the active tier key for a user. Defaults to 'free' if no row exists.
 */
export const getUserTierKey = async (userId: string): Promise<TierKey> => {
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

  const userTier = await getCurrentUserTier(userId);
  if (!userTier) return; // No tier row — treat as free; if free has no explicit deny, allow by default.

  const entitlements = await listTierEntitlements(userTier.tierId);
  const entry = entitlements.find(e => e.featureId === feature.id);
  // If no explicit entitlement row, default to allowed (open by default for configured features).
  if (entry && !entry.isAllowed) {
    throw new EntitlementError(
      'FEATURE_NOT_ENTITLED',
      `Your current plan does not include access to '${featureKey}'`,
      { featureKey }
    );
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
  const metricKey = 'ai_itinerary_generations';

  if (role === 'admin') {
    // Still increment for observability, but don't enforce the cap.
    try {
      await incrementUsageCounter(userId, metricKey, windowKey);
    } catch (err) {
      logError('[entitlement] Failed to increment generation counter for admin', err);
    }
    return;
  }

  const limit = await getEffectiveLimit(userId, 'ai_itinerary_generations_per_month');
  if (limit === null || limit === -1) {
    // No limit configured — still track but allow.
    try {
      await incrementUsageCounter(userId, metricKey, windowKey);
    } catch (err) {
      logError('[entitlement] Failed to increment generation counter', err);
    }
    return;
  }

  const result = await atomicIncrementIfUnderLimit(userId, metricKey, windowKey, limit);
  if (!result.allowed) {
    throw new EntitlementError(
      'TIER_LIMIT_REACHED',
      `You have reached the AI itinerary generation limit of ${limit} for this month`,
      { limitKey: 'ai_itinerary_generations_per_month' }
    );
  }
};
