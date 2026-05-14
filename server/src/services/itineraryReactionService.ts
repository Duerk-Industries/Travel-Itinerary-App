import {
  castItineraryDetailReaction,
  clearItineraryDetailReaction,
  getItineraryDetailContext,
  getItineraryDetailReactionSummaries,
} from '../db';
import type { ItineraryDetail, ItineraryDetailReactionSummary } from '../types';

export const REACTION_FEATURE_FLAG = 'itinerary_reactions';

const EMPTY_SUMMARY: ItineraryDetailReactionSummary = {
  score: 0,
  upCount: 0,
  downCount: 0,
  userValue: null,
};

export const emptyReactionSummary = (): ItineraryDetailReactionSummary => ({ ...EMPTY_SUMMARY });

export const resolveDetailContext = async (
  detailId: string
): Promise<{ tripId: string; itineraryId: string } | null> =>
  getItineraryDetailContext(detailId);

export const getReactionSummaryForDetail = async (
  userId: string,
  detailId: string
): Promise<ItineraryDetailReactionSummary> => {
  const summaries = await getItineraryDetailReactionSummaries(userId, [detailId]);
  return summaries[detailId] ?? emptyReactionSummary();
};

export const upsertReaction = async (
  userId: string,
  tripId: string,
  detailId: string,
  value: 1 | -1
): Promise<ItineraryDetailReactionSummary> => {
  await castItineraryDetailReaction(userId, tripId, detailId, value);
  return getReactionSummaryForDetail(userId, detailId);
};

export const removeReaction = async (
  userId: string,
  detailId: string
): Promise<ItineraryDetailReactionSummary> => {
  await clearItineraryDetailReaction(userId, detailId);
  return getReactionSummaryForDetail(userId, detailId);
};

export const attachReactionsToDetails = async <T extends ItineraryDetail>(
  userId: string,
  details: T[]
): Promise<Array<T & { reactions: ItineraryDetailReactionSummary }>> => {
  if (!details.length) return [];
  const ids = details.map((d) => d.id);
  const summaries = await getItineraryDetailReactionSummaries(userId, ids);
  return details.map((d) => ({
    ...d,
    reactions: summaries[d.id] ?? emptyReactionSummary(),
  }));
};
