import { getItemVoteSummaries } from '../db';

export type VoteItemType = 'flight' | 'lodging' | 'tour' | 'car_rental';

export const applyVoteSummary = async <T extends { id: string }>(
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  items: T[]
): Promise<Array<T & { netVotes: number; userVote: -1 | 1 | null }>> => {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);
  const summary = await getItemVoteSummaries(userId, tripId, itemType, ids);
  return items.map((item) => ({
    ...item,
    netVotes: summary[item.id]?.netVotes ?? 0,
    userVote: summary[item.id]?.userVote ?? null,
  }));
};
