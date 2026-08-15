import { logInfo, logError } from '../logger';
import { getDb } from '../db';
import { InterestWeightsSchema } from '../schemas/itineraryCacheSchemas';

/**
 * Standard nine dimensions from the spec.
 */
const DIMENSIONS = [
  'outdoors',
  'adventure',
  'culture',
  'food',
  'nightlife',
  'relaxing',
  'photography',
  'authentic_local',
  'iconic_landmarks',
] as const;

type MeanVector = Record<typeof DIMENSIONS[number], number>;

let cachedMeanVector: MeanVector | null = null;

/**
 * Pre-computes the global corpus mean vector.
 * Implementation of §1.2.
 */
export const refreshMeanVector = async (): Promise<MeanVector> => {
  try {
    const db = getDb();
    // Assuming blocks are stored in a way we can query their interest weights.
    // The spec says "ActivityBlock" is a cached unit.
    // For now, I'll assume we can fetch them from Firestore 'itinerary_blocks'
    // or a similar collection group.

    const blocksSnap = await db.collectionGroup('itinerary_blocks').get();
    const count = blocksSnap.size;

    if (count === 0) {
      const defaultMean = Object.fromEntries(DIMENSIONS.map(d => [d, 5.5])) as MeanVector;
      cachedMeanVector = defaultMean;
      return defaultMean;
    }

    const sums: Record<string, number> = Object.fromEntries(DIMENSIONS.map(d => [d, 0]));

    blocksSnap.docs.forEach(doc => {
      const data = doc.data();
      const weights = data.interest_weights;
      const validation = InterestWeightsSchema.safeParse(weights);
      if (validation.success) {
        DIMENSIONS.forEach(d => {
          sums[d] += validation.data[d];
        });
      }
    });

    const mean = Object.fromEntries(
      DIMENSIONS.map(d => [d, sums[d] / count])
    ) as MeanVector;

    cachedMeanVector = mean;
    logInfo('[mean-vector] Refreshed global corpus mean', { count, mean });
    return mean;
  } catch (err) {
    logError('[mean-vector] Failed to refresh mean vector', err);
    throw err;
  }
};

export const getMeanVector = async (): Promise<MeanVector> => {
  if (cachedMeanVector) return cachedMeanVector;
  return refreshMeanVector();
};
