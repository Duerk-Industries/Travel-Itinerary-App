import { getItemVoteSummaries } from '../db';

export type VoteItemType = 'flight' | 'lodging' | 'tour' | 'car_rental';

export const applyVoteSummary = async <T extends { id: string }>(
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  items: T[]
): Promise<Array<T & { netVotes: number; userVote: -1 | 1 | null; netRating: number; userRating: -1 | 1 | null }>> => {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);
  const voteSummary = await getItemVoteSummaries(userId, tripId, itemType, ids, 'vote');
  const ratingSummary = await getItemVoteSummaries(userId, tripId, itemType, ids, 'rating');
  return items.map((item) => ({
    ...item,
    netVotes: voteSummary[item.id]?.netVotes ?? 0,
    userVote: voteSummary[item.id]?.userVote ?? null,
    netRating: ratingSummary[item.id]?.netVotes ?? 0,
    userRating: ratingSummary[item.id]?.userVote ?? null,
  }));
};
