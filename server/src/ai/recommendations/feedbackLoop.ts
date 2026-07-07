import { listAiRecommendations, updateAiRecommendationStatus } from '../../db';
import { logError } from '../../logger';

export const expireStaleRecommendations = async (olderThanDays = 30): Promise<number> => {
  const proposed = await listAiRecommendations({ status: 'proposed', limit: 500 });
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let expired = 0;
  for (const recommendation of proposed) {
    if (new Date(recommendation.createdAt).getTime() >= cutoff) continue;
    try {
      await updateAiRecommendationStatus({
        recommendationId: recommendation.recommendationId,
        status: 'expired',
        respondedBy: null,
      });
      expired += 1;
    } catch (err) {
      logError('[ai-recommendations] failed to expire stale recommendation', err);
    }
  }
  return expired;
};
