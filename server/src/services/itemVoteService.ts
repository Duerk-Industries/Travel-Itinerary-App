import { getItemVoteSummaries } from '../db';

export type VoteItemType = 'flight' | 'lodging' | 'activity' | 'car_rental';

const normalizeVoteSummaryKey = (id: string): string => String(id).trim().toLowerCase();

export const applyVoteSummary = async <T extends { id: string }>(
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  items: T[]
): Promise<Array<T & {
  netVotes: number;
  userVote: -1 | 1 | null;
  upVotes: number;
  downVotes: number;
  upVoterIds: string[];
  downVoterIds: string[];
  netRating: number;
  userRating: -1 | 1 | null;
}>> => {
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
  return items.map((item) => {
    const vote = normalizedVoteSummary[normalizeVoteSummaryKey(item.id)];
    return {
      ...item,
      netVotes: vote?.netVotes ?? 0,
      userVote: vote?.userVote ?? null,
      upVotes: vote?.upVotes ?? 0,
      downVotes: vote?.downVotes ?? 0,
      upVoterIds: vote?.upVoterIds ?? [],
      downVoterIds: vote?.downVoterIds ?? [],
      netRating: normalizedRatingSummary[normalizeVoteSummaryKey(item.id)]?.netVotes ?? 0,
      userRating: normalizedRatingSummary[normalizeVoteSummaryKey(item.id)]?.userVote ?? null,
    };
  });
};
