import { getItemVoteSummaries } from '../db';

export type VoteItemType = 'flight' | 'lodging' | 'activity' | 'car_rental';

const normalizeVoteSummaryKey = (id: string): string => String(id).trim().toLowerCase();

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
  const normalizedVoteSummary = Object.fromEntries(
    Object.entries(voteSummary).map(([id, summary]) => [normalizeVoteSummaryKey(id), summary])
  );
  const normalizedRatingSummary = Object.fromEntries(
    Object.entries(ratingSummary).map(([id, summary]) => [normalizeVoteSummaryKey(id), summary])
  );
  return items.map((item) => ({
    ...item,
    netVotes: normalizedVoteSummary[normalizeVoteSummaryKey(item.id)]?.netVotes ?? 0,
    userVote: normalizedVoteSummary[normalizeVoteSummaryKey(item.id)]?.userVote ?? null,
    netRating: normalizedRatingSummary[normalizeVoteSummaryKey(item.id)]?.netVotes ?? 0,
    userRating: normalizedRatingSummary[normalizeVoteSummaryKey(item.id)]?.userVote ?? null,
  }));
};
