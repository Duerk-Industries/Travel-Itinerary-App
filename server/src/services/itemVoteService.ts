import { getItemVoteSummaries, listItemRatings, setItemRating } from '../db';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';

export type VoteItemType = 'flight' | 'lodging' | 'activity' | 'car_rental';

export type ItemRatingSummary = {
  averageRating: number | null;
  ratingCount: number;
  userStars: number | null;
  // Builds released before star ratings read only these two.
  netRating: number;
  userRating: -1 | 1 | null;
};

const normalizeVoteSummaryKey = (id: string): string => String(id).trim().toLowerCase();

const emptyRatingSummary = (): ItemRatingSummary => ({ averageRating: null, ratingCount: 0, userStars: null, netRating: 0, userRating: null });

const starsToThumb = (stars: number): -1 | 1 => (stars >= 3 ? 1 : -1);

/**
 * Item ids (lowercased) to each traveler's rating. Earlier thumbs count as 5 stars (up) or 1 star
 * (down), and a traveler's star rating replaces their thumb.
 */
export const getItemRatingSummaries = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  itemIds: string[]
): Promise<Record<string, ItemRatingSummary>> => {
  const [legacyThumbs, ratings] = await Promise.all([
    getItemVoteSummaries(userId, tripId, itemType, itemIds, 'rating'),
    listItemRatings(tripId, itemType, itemIds),
  ]);
  const starsByItem = new Map<string, Map<string, number>>();
  const addStars = (itemId: string, raterId: string, stars: number) => {
    const key = normalizeVoteSummaryKey(itemId);
    if (!starsByItem.has(key)) starsByItem.set(key, new Map());
    starsByItem.get(key)!.set(raterId, stars);
  };
  Object.entries(legacyThumbs ?? {}).forEach(([itemId, thumbs]) => {
    (thumbs.upVoterIds ?? []).forEach((raterId) => addStars(itemId, raterId, 5));
    (thumbs.downVoterIds ?? []).forEach((raterId) => addStars(itemId, raterId, 1));
  });
  (ratings ?? []).forEach((rating) => addStars(rating.itemId, rating.userId, rating.stars));

  const summaries: Record<string, ItemRatingSummary> = {};
  starsByItem.forEach((byRater, key) => {
    const stars = [...byRater.values()];
    const userStars = byRater.get(userId) ?? null;
    summaries[key] = {
      averageRating: stars.length ? Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 10) / 10 : null,
      ratingCount: stars.length,
      userStars,
      netRating: stars.reduce((sum, value) => sum + starsToThumb(value), 0),
      userRating: userStars == null ? null : starsToThumb(userStars),
    };
  });
  return summaries;
};

/** Saves a traveler's stars and returns the item's updated rating. */
export const saveItemRating = async (
  userId: string,
  tripId: string,
  itemType: VoteItemType,
  itemId: string,
  stars: number
): Promise<ItemRatingSummary & { itemId: string }> => {
  await setItemRating(userId, tripId, itemType, itemId, stars);
  const summaries = await getItemRatingSummaries(userId, tripId, itemType, [itemId]);
  return { itemId, ...(summaries[normalizeVoteSummaryKey(itemId)] ?? emptyRatingSummary()) };
};

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
} & ItemRatingSummary>> => {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);
  const voteSummary = await getItemVoteSummaries(userId, tripId, itemType, ids, 'vote');
  const ratingSummaries = await getItemRatingSummaries(userId, tripId, itemType, ids);
  const normalizedVoteSummary = Object.fromEntries(
    Object.entries(voteSummary).map(([id, summary]) => [normalizeVoteSummaryKey(id), summary])
  );
  return items.map((item) => {
    const vote = normalizedVoteSummary[normalizeVoteSummaryKey(item.id)];
    return {
      ...item,
      ...('status' in item ? { status: normalizeItineraryStatus(item.status) } : {}),
      netVotes: vote?.netVotes ?? 0,
      userVote: vote?.userVote ?? null,
      upVotes: vote?.upVotes ?? 0,
      downVotes: vote?.downVotes ?? 0,
      upVoterIds: vote?.upVoterIds ?? [],
      downVoterIds: vote?.downVoterIds ?? [],
      ...(ratingSummaries[normalizeVoteSummaryKey(item.id)] ?? emptyRatingSummary()),
    };
  });
};
