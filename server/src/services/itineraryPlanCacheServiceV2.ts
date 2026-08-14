import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BindingPlanSchema, type ActivityBlock, type BindingPlan } from '../schemas/itineraryCacheSchemas';
import { readItineraryPlanCache, stableHash, writeItineraryPlanCache } from './itineraryPlanCacheService';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';

/**
 * Canonical compatibility projection for Tier 0 cache hits.
 * No private data (account IDs, exact dates) may enter this structure.
 */
export const CacheCompatibilityProjectionSchema = z.object({
  schema_version: z.literal('binding-plan-v2'),
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
  await reserveApiUsageOrThrow({ provider: 'ITINERARY_CACHE_STORAGE', caller: 'BINDING_READ', units: 1, requireConfiguredLimit: true });
  await recordProviderRequestCost({ provider: 'ITINERARY_CACHE_STORAGE', costPerRequestUsd: 0 });
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
  await reserveApiUsageOrThrow({ provider: 'ITINERARY_CACHE_STORAGE', caller: 'BINDING_WRITE', units: 1, requireConfiguredLimit: true });
  await recordProviderRequestCost({ provider: 'ITINERARY_CACHE_STORAGE', costPerRequestUsd: 0 });
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
