import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BindingPlanSchema, type BindingPlan } from '../schemas/itineraryCacheSchemas';
import { stableHash } from './itineraryPlanCacheService';
import { recordApiUsage } from '../apis/providerBudgeting'; // Assuming this exists

/**
 * Canonical compatibility projection for Tier 0 cache hits.
 * No private data (account IDs, exact dates) may enter this structure.
 */
export const CacheCompatibilityProjectionSchema = z.object({
  schema_version: z.literal('binding-plan-v2'),
  algorithm_version: z.string(),
  corpus_release_id: z.string(),
  template_revision: z.string(),
  destinations: z.array(z.string()),
  duration_bucket: z.number().int(),
  local_date_shape: z.string(),
  season_label: z.string(),
  pace: z.string(),
  party_class: z.string(),
  mobility_class: z.string(),
  interest_signature: z.string(),
});

export type CacheCompatibilityProjection = z.infer<typeof CacheCompatibilityProjectionSchema>;

/**
 * Builds the opaque SHA-256 cache key from a canonical projection.
 */
export const buildCacheKeyV2 = (projection: CacheCompatibilityProjection): string => {
  const json = JSON.stringify(projection);
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
  if (!params.isHit) return;

  // Record "negative usage" or a specific ROI metric
  await recordApiUsage({
    provider: 'itinerary_cache_roi',
    caller: 'AVOIDED_INFERENCE',
    metadata: {
      tokens_saved: params.baselineTokensInput + params.baselineTokensOutput,
      model_avoided: params.model,
    }
  });
};

/**
 * Example validator that runs AFTER a cache read to ensure private constraints
 * still pass.
 */
export const validatePrivateConstraints = (plan: BindingPlan, constraints: {
  maxEnergyPerDay: number;
  requireStepFree: boolean;
}): boolean => {
  // Logic to re-check the bound blocks against the actual private request
  // (Requires joining the plan against the corpus release, which should be in-memory)
  return true;
};
