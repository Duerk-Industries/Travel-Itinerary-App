import { ActivityBlock, BindingPlan } from '../schemas/itineraryCacheSchemas';
import { getMeanVector } from './meanVectorService';

/**
 * Mean-centered cosine similarity between two 1-10 vectors.
 */
export const cosineSimilarity = (a: Record<string, number>, b: Record<string, number>, mean: Record<string, number>): number => {
  const dimensions = Object.keys(mean);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const d of dimensions) {
    const valA = (a[d] ?? 5.5) - mean[d];
    const valB = (b[d] ?? 5.5) - mean[d];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Tier 1 Deterministic Selector (§6).
 * Assembles a compatible itinerary from available blocks based on user preferences.
 */
export const selectDeterministicItinerary = async (params: {
  blocks: ActivityBlock[];
  userWeights: Record<string, number>;
  days: number;
}): Promise<BindingPlan | null> => {
  const mean = await getMeanVector();
  const sortedBlocks = [...params.blocks].sort((a, b) => {
    const scoreA = cosineSimilarity(a.interest_weights, params.userWeights, mean);
    const scoreB = cosineSimilarity(b.interest_weights, params.userWeights, mean);
    return scoreB - scoreA;
  });

  const plan: BindingPlan = { days: [] };
  const seen = new Set<string>();

  for (let i = 1; i <= params.days; i++) {
    // Very basic day template: 1 anchor, 1 meal, 1 supporting
    const dayBindings: Record<string, string | null> = { s1: null, s2: null, s3: null };

    // Fill s1 (Anchor)
    const anchor = sortedBlocks.find(b => b.role === 'anchor' && !seen.has(b.block_id));
    if (anchor) {
      dayBindings.s1 = anchor.block_id;
      seen.add(anchor.block_id);
    }

    // Fill s2 (Meal)
    const meal = sortedBlocks.find(b => b.role === 'meal' && !seen.has(b.block_id));
    if (meal) {
      dayBindings.s2 = meal.block_id;
      seen.add(meal.block_id);
    }

    // Fill s3 (Supporting)
    const supporting = sortedBlocks.find(b => b.role === 'supporting' && !seen.has(b.block_id));
    if (supporting) {
      dayBindings.s3 = supporting.block_id;
      seen.add(supporting.block_id);
    }

    plan.days.push({
      day: i,
      template: 'tpl_basic',
      bindings: dayBindings,
      zone_focus: anchor?.zone_id || 'unknown',
      reason_codes: ['DETERMINISTIC_SELECT'],
    });
  }

  return plan;
};
