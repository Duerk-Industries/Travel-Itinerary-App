import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { z } from 'zod';
import { getItineraryPlanCacheEntry, upsertItineraryPlanCacheEntry, getAdminSetting, atomicIncrementApiUsageIfUnderLimit } from '../db';
import type { AttractionCatalogEntry, ItineraryPlanCacheEntry } from '../types';
import { isFeatureEnabled } from './entitlementService';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { BindingPlanSchema, type ActivityBlock, type BindingPlan } from '../schemas/itineraryCacheSchemas';
import { logInfo, logError } from '../logger';
import { getApiLimitProviderConfig } from '../config/apiLimits';
import { getApiRequestPricingUsd } from '../apis/providerBudgeting';

export const ITINERARY_CACHE_SCHEMA_VERSION = 'itinerary-cache-v1';
export const ITINERARY_CACHE_SCHEMA_VERSION_V2 = 'binding-plan-v2';

/**
 * Canonical compatibility projection for Tier 0 cache hits.
 * No private data (account IDs, exact dates) may enter this structure.
 */
export const CacheCompatibilityProjectionSchema = z.object({
  schema_version: z.literal(ITINERARY_CACHE_SCHEMA_VERSION_V2),
  algorithm_version: z.string().max(80),
  corpus_release_id: z.string().max(160),
  template_revision: z.string().max(160),
  destinations: z.array(z.string().max(160)).min(1).max(8),
  duration_bucket: z.number().int().min(1).max(31),
  local_date_shape: z.string().max(80),
  season_label: z.string().max(40),
  pace: z.string().max(40),
  party_class: z.string().max(40),
  mobility_class: z.string().max(40),
  interest_signature: z.string().max(160),
}).strict();

export type CacheCompatibilityProjection = z.infer<typeof CacheCompatibilityProjectionSchema>;

/**
 * L0 (Local LRU) cache. Simple bounded Map implementation.
 */
const L0_CACHE_MAX_ENTRIES = 256;
const l0Cache = new Map<string, { payload: any; localExpiresAt: number; sourceExpiresAt: number }>();

const getL0 = (key: string, now = new Date()): any | null => {
  const entry = l0Cache.get(key);
  if (!entry) return null;
  // Check both the process-local TTL and the authoritative cache-entry
  // expiration. This prevents L0 from reviving an expired L1 entry when a
  // caller supplies a logical clock (for example, a replay or test).
  if (entry.localExpiresAt <= Date.now() || entry.sourceExpiresAt <= now.getTime()) {
    l0Cache.delete(key);
    return null;
  }
  // Move to end (LRU behavior)
  l0Cache.delete(key);
  l0Cache.set(key, entry);
  return entry.payload;
};

const setL0 = (key: string, payload: any, ttlMs: number, sourceExpiresAt: number) => {
  if (l0Cache.size >= L0_CACHE_MAX_ENTRIES) {
    const firstKey = l0Cache.keys().next().value;
    if (firstKey !== undefined) l0Cache.delete(firstKey);
  }
  l0Cache.set(key, { payload, localExpiresAt: Date.now() + ttlMs, sourceExpiresAt });
};

export interface ItineraryCacheCapabilities {
  enabled: boolean;
  reads: boolean;
  writes: boolean;
  llmBinding: boolean;
  staleRevalidate: boolean;
}

/**
 * Resolves the hierarchical feature flags for the itinerary cache.
 * Implements the dependency DAG from §18.
 */
export const resolveItineraryCacheCapabilities = async (userId: string, role?: string): Promise<ItineraryCacheCapabilities> => {
  const ready = await checkItineraryCacheReadiness();
  if (!ready) {
    return { enabled: false, reads: false, writes: false, llmBinding: false, staleRevalidate: false };
  }

  const master = await isFeatureEnabled('itinerary_block_cache', userId, role);
  if (!master) {
    return { enabled: false, reads: false, writes: false, llmBinding: false, staleRevalidate: false };
  }

  const reads = await isFeatureEnabled('itinerary_block_cache_reads', userId, role);
  const writes = await isFeatureEnabled('itinerary_block_cache_writes', userId, role);
  const llmBinding = await isFeatureEnabled('itinerary_block_cache_llm_binding', userId, role);
  const staleRevalidate = await isFeatureEnabled('itinerary_block_cache_stale_revalidate', userId, role);

  return {
    enabled: true,
    reads: reads,
    writes: writes && reads, // Writes depend on reads
    llmBinding: llmBinding,
    staleRevalidate: staleRevalidate && reads, // Revalidate depends on reads
  };
};

/**
 * Fail-closed readiness check (§18).
 */
export const checkItineraryCacheReadiness = async (): Promise<boolean> => {
  try {
    // 1. Check finite limits for storage
    const storageConfig = getApiLimitProviderConfig('ITINERARY_CACHE_STORAGE');
    if (!storageConfig || storageConfig.overall === null || storageConfig.callers?.BINDING_READ == null) return false;

    // 2. Check budgets for inference if needed (placeholder, actual check happens at call site)
    // 3. Check active corpus pointer
    const activeRelease = await getAdminSetting('ACTIVE_CORPUS_RELEASE_ID');
    if (!activeRelease) return false;

    return true;
  } catch (err) {
    logError('[itinerary-cache] Readiness check failed', err);
    return false;
  }
};

/**
 * Builds the opaque SHA-256 cache key from a canonical projection.
 */
export const buildCacheKeyV2 = (projection: CacheCompatibilityProjection): string => {
  const normalized = CacheCompatibilityProjectionSchema.parse(projection);
  const json = JSON.stringify(normalized);
  return createHash('sha256').update(json).digest('hex');
};

/**
 * Measures the economic ROI of a cache hit by calculating avoided token costs.
 */
export const recordCacheRoi = async (params: {
  isHit: boolean;
  baselineTokensInput: number;
  baselineTokensOutput: number;
  model: string;
}) => {
  // Avoided inference is telemetry, not a negative provider cost. Callers can
  // feed this bounded value into the existing metrics/estimator pipeline.
  return params.isHit
    ? { tokensSaved: Math.max(0, params.baselineTokensInput) + Math.max(0, params.baselineTokensOutput), model: params.model }
    : { tokensSaved: 0, model: params.model };
};

export const readBindingPlanCache = async (params: {
  projection: CacheCompatibilityProjection;
  dependencyFingerprint: string;
  now?: Date;
}): Promise<BindingPlan | null> => {
  const signature = stableHash(params.projection);
  const payload = await readItineraryPlanCache<unknown>({
    stage: 'binding_plan',
    signature,
    dependencyFingerprint: params.dependencyFingerprint,
    now: params.now,
  });
  const parsed = BindingPlanSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

export const writeBindingPlanCache = async (params: {
  projection: CacheCompatibilityProjection;
  dependencyFingerprint: string;
  plan: BindingPlan;
  ttlDays: number;
  now?: Date;
}): Promise<void> => {
  const parsed = BindingPlanSchema.parse(params.plan);
  await writeItineraryPlanCache({
    stage: 'binding_plan',
    signature: stableHash(params.projection),
    dependencyFingerprint: params.dependencyFingerprint,
    payload: parsed,
    ttlDays: Math.max(1, Math.min(90, params.ttlDays)),
    now: params.now,
  });
};

/**
 * Example validator that runs AFTER a cache read to ensure private constraints
 * still pass.
 */
export const validatePrivateConstraints = (plan: BindingPlan, constraints: {
  maxEnergyPerDay: number;
  requireStepFree: boolean;
  blocks: Record<string, ActivityBlock>;
}): boolean => {
  const parsed = BindingPlanSchema.safeParse(plan);
  if (!parsed.success || !constraints.blocks || !Number.isFinite(constraints.maxEnergyPerDay)) return false;
  const seen = new Set<string>();
  for (const day of parsed.data.days) {
    let energy = 0;
    for (const blockId of Object.values(day.bindings)) {
      if (!blockId) continue;
      if (seen.has(blockId)) return false;
      seen.add(blockId);
      const block = constraints.blocks[blockId];
      if (!block) return false;
      energy += block.energy_cost;
      if (constraints.requireStepFree) {
        const accessibility = (block as unknown as { audience?: { accessibility?: { step_free?: boolean } } }).audience?.accessibility;
        if (accessibility?.step_free !== true) return false;
      }
    }
    if (energy > constraints.maxEnergyPerDay) return false;
  }
  return true;
};

/**
 * Convert cache payloads to the small set of values accepted by every DB
 * adapter. Firestore rejects undefined values and arbitrary class instances
 * nested inside an entity (for example a Date-like SDK object, Map, or a
 * provider response wrapper). Itinerary caches are JSON-shaped, so preserve
 * Dates, recurse through arrays/plain objects, and serialize any other
 * object through toJSON/string rather than sending an invalid nested entity.
 */
export const stripUndefinedDeep = <T>(value: T): T => {
  if (value === undefined) return null as T;
  if (typeof value === 'bigint') return String(value) as T;
  if (typeof value === 'function' || typeof value === 'symbol') return null as T;
  if (typeof value === 'number' && !Number.isFinite(value)) return null as T;
  if (Array.isArray(value)) return value.map((item) => stripUndefinedDeep(item)) as T;
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      const toJSON = (value as any).toJSON;
      if (typeof toJSON === 'function') return stripUndefinedDeep(toJSON.call(value)) as T;
      return String(value) as T;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedDeep(item)])
    ) as T;
  }
  return value;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
};
export const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export type TripSignatureInput = {
  destinations: string[]; duration: number; pace: string; comfort: string; mobility: string;
  car: string; interactionStyle: string; budgetMin: number; budgetMax: number; startDate: string; endDate: string;
  weights?: Record<string, number>;
  startHub?: string | null;
  endHub?: string | null;
};

export const buildTripSignature = (input: TripSignatureInput, includeWeights = false): string => stableHash({
  version: ITINERARY_CACHE_SCHEMA_VERSION,
  destinations: input.destinations.map((value) => value.trim().toLowerCase()), duration: input.duration,
  pace: input.pace, comfort: input.comfort, mobility: input.mobility, car: input.car,
  interactionStyle: input.interactionStyle, budgetMin: Math.round(input.budgetMin / 100) * 100,
  budgetMax: Math.round(input.budgetMax / 100) * 100, startDate: input.startDate, endDate: input.endDate,
  ...(includeWeights ? { weights: input.weights ?? {} } : {}),
  startHub: String(input.startHub ?? '').trim().toLowerCase(), endHub: String(input.endHub ?? '').trim().toLowerCase(),
});

export const buildCatalogFingerprint = (byDestination: Record<string, AttractionCatalogEntry[]>): string => stableHash(
  Object.entries(byDestination).sort(([a], [b]) => a.localeCompare(b)).map(([destination, entries]) => ({
    destination: destination.toLowerCase(), entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
      id: entry.id,
      name: entry.name,
      rank: entry.rank,
      activityType: entry.activityType,
      interestTags: [...entry.interestTags].sort(),
      budgetTier: entry.budgetTier ?? null,
      lat: entry.lat ?? null,
      lon: entry.lon ?? null,
      primaryTag: entry.primaryTag ?? null,
      popularityScore: entry.popularityScore ?? null,
      wikipediaTitle: entry.wikipediaTitle ?? null,
      wikipediaSummary: entry.wikipediaSummary ?? null,
    })),
  }))
);

export const buildPromptFingerprint = (templates: unknown): string => stableHash(templates);
export const buildCacheKey = (stage: 'route' | 'day' | 'binding_plan', signature: string, dependencyFingerprint: string): string =>
  `it-plan:${stage}:${stableHash({ signature, dependencyFingerprint }).slice(0, 40)}`;

export const readItineraryPlanCache = async <T>(params: {
  stage: 'route' | 'day' | 'binding_plan';
  signature: string;
  dependencyFingerprint: string;
  now?: Date;
  userId?: string;
}): Promise<T | null> => {
  const cacheKey = buildCacheKey(params.stage, params.signature, params.dependencyFingerprint);

  // 1. L0 Cache check
  const l0Hit = getL0(cacheKey, params.now ?? new Date());
  if (l0Hit) return l0Hit as T;

  // 2. Resource reservation (L1 Read)
  try {
    await reserveApiUsageOrThrow({
      provider: 'ITINERARY_CACHE_STORAGE',
      caller: 'BINDING_READ',
    });
  } catch (err) {
    logInfo('[itinerary-cache] Read skipped: limit reached');
    return null;
  }

  const entry = await getItineraryPlanCacheEntry(cacheKey);
  if (!entry || entry.signature !== params.signature || entry.dependencyFingerprint !== params.dependencyFingerprint) return null;
  if (!entry.expiresAt || new Date(entry.expiresAt).getTime() <= (params.now ?? new Date()).getTime()) return null;

  let payload = entry.payload as T;

  // 2.1 Decompression if needed
  if (entry.compression === 'br' && typeof payload === 'string') {
    try {
      const buffer = Buffer.from(payload, 'base64');
      const decompressed = brotliDecompressSync(buffer).toString('utf8');
      payload = JSON.parse(decompressed) as T;
    } catch (err) {
      logError('[itinerary-cache] Decompression failed', { cacheKey, err });
      return null;
    }
  }

  // 3. Schema validation for binding_plan
  if (params.stage === 'binding_plan') {
    const validation = BindingPlanSchema.safeParse(payload);
    if (!validation.success) {
      logError('[itinerary-cache] Corrupt binding_plan entry quarantined', { cacheKey, errors: validation.error.format() });
      return null;
    }
  }

  // 4. Back-fill L0
  setL0(cacheKey, payload, 5 * 60 * 1000, new Date(entry.expiresAt).getTime()); // 5 min default L0 TTL

  return payload;
};

export const writeItineraryPlanCache = async <T>(params: {
  stage: 'route' | 'day' | 'binding_plan';
  signature: string;
  dependencyFingerprint: string;
  payload: T;
  ttlDays: number;
  fragments?: unknown[];
  now?: Date;
  userId?: string;
}): Promise<ItineraryPlanCacheEntry | null> => {
  const now = params.now ?? new Date();
  const cacheKey = buildCacheKey(params.stage, params.signature, params.dependencyFingerprint);
  const strippedPayload = stripUndefinedDeep(params.payload);

  // 1. ROI-Gated Writes repetition check (§2.2)
  if (params.stage === 'binding_plan') {
    const windowKey = now.toISOString().slice(0, 10);
    const result = await atomicIncrementApiUsageIfUnderLimit({
      provider: 'ITINERARY_CACHE_STORAGE',
      caller: `REPETITION:${cacheKey.slice(0, 32)}`,
      scope: 'caller',
      windowKey,
      limit: 10, // Max 10 counts per day for this key
    });
    const threshold = 3; // Initial hypothesis (§10)
    if (result.newCount < threshold) {
      logInfo(`[itinerary-cache] Repetition threshold not met, skipping L1 write cacheKey=${cacheKey} count=${result.newCount}`);
      return null;
    }
  }

  // 1.1 Schema validation for binding_plan
  if (params.stage === 'binding_plan') {
    const validation = BindingPlanSchema.safeParse(strippedPayload);
    if (!validation.success) {
      logError('[itinerary-cache] Rejecting invalid binding_plan write', { cacheKey, errors: validation.error.format() });
      return null;
    }
  }

  const serialized = JSON.stringify(strippedPayload);
  const byteCount = Buffer.byteLength(serialized, 'utf8');

  // 2. Hard caps check (§16.2)
  if (byteCount > 64 * 1024) {
    logInfo(`[itinerary-cache] Payload exceeds 64KiB cap, skipping L1 write cacheKey=${cacheKey} bytes=${byteCount}`);
    return null;
  }

  // 3. Resource reservation (L1 Write + Byte count)
  try {
    await reserveApiUsageOrThrow({
      provider: 'ITINERARY_CACHE_STORAGE',
      caller: 'BINDING_WRITE',
    });
    // Weighted unit reservation for bytes
    await reserveApiUsageOrThrow({
      provider: 'ITINERARY_CACHE_STORAGE',
      caller: 'RETAINED_KIB',
      units: Math.ceil(byteCount / 1024),
    });
  } catch (err) {
    logInfo('[itinerary-cache] Write skipped: limit reached');
    return null;
  }

  // 4. Write L1
  let finalPayload: any = strippedPayload;
  let compression: 'br' | 'none' = 'none';

  if (byteCount > 8 * 1024) {
    try {
      const compressed = brotliCompressSync(Buffer.from(serialized, 'utf8'));
      finalPayload = compressed.toString('base64');
      compression = 'br';
    } catch (err) {
      logError('[itinerary-cache] Compression failed, writing uncompressed', { cacheKey, err });
    }
  }

  const entry = await upsertItineraryPlanCacheEntry({
    id: cacheKey,
    cacheKey,
    stage: params.stage,
    signature: params.signature,
    dependencyFingerprint: params.dependencyFingerprint,
    payload: finalPayload,
    compression,
    fragments: stripUndefinedDeep(params.fragments ?? []),
    expiresAt: new Date(now.getTime() + Math.max(1, params.ttlDays) * 86400000).toISOString(),
    updatedAt: now.toISOString(),
  });

  // 5. Update L0
  setL0(
    cacheKey,
    strippedPayload,
    5 * 60 * 1000,
    new Date(now.getTime() + Math.max(1, params.ttlDays) * 86400000).getTime()
  );

  return entry;
};

export const buildDayFragments = <T>(days: T[], size = 3): T[][] => {
  const fragments: T[][] = [];
  for (let index = 0; index < days.length; index += Math.max(1, size)) fragments.push(days.slice(index, index + Math.max(1, size)));
  return fragments;
};
