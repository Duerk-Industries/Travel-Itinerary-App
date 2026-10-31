import { getItemVoteSummaries } from '../db';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';
import { applyStarRatings } from './itemRatingService';

export type VoteItemType = 'flight' | 'lodging' | 'activity' | 'car_rental';

const normalizeVoteSummaryKey = (id: string): string => String(id).trim().toLowerCase();

/**
 * Adds the thumb-vote summary and the star rating to each item: `averageRating` is the mean of every traveler's
 * ratings of the item's provider (null until rated) and `userRating` is the requesting traveler's own 1-5 stars.
 */
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
  averageRating: number | null;
  userRating: number | null;
}>> => {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);
  const voteSummary = await getItemVoteSummaries(userId, tripId, itemType, ids, 'vote');
  const rated = await applyStarRatings(userId, itemType, items);
  const normalizedVoteSummary = Object.fromEntries(
    Object.entries(voteSummary).map(([id, summary]) => [normalizeVoteSummaryKey(id), summary])
  );
  return rated.map((item) => {
    const vote = normalizedVoteSummary[normalizeVoteSummaryKey(item.id)];
    return {
      ...item,
      ...('status' in item ? { status: normalizeItineraryStatus((item as { status?: unknown }).status) } : {}),
      netVotes: vote?.netVotes ?? 0,
      userVote: vote?.userVote ?? null,
      upVotes: vote?.upVotes ?? 0,
      downVotes: vote?.downVotes ?? 0,
      upVoterIds: vote?.upVoterIds ?? [],
      downVoterIds: vote?.downVoterIds ?? [],
    };
  });
};
