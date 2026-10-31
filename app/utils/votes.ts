import { normalizeItineraryStatus } from './itineraryStatus';

// Kept for older callers; proposal voting has been retired.
export const shouldShowVoteButtons = (_status: unknown, _userVote: number | null | undefined): boolean => false;

export const canRateItem = (status: unknown): boolean => normalizeItineraryStatus(status, 'Booked') === 'Completed';

export const MAX_STARS = 5;

export const normalizeStars = (value: unknown): number | null => {
  const stars = Number(value);
  return Number.isInteger(stars) && stars >= 1 && stars <= MAX_STARS ? stars : null;
};

export const normalizeRatingFields = (item: any) => ({
  averageRating: item.averageRating == null ? null : Number(item.averageRating) || null,
  ratingCount: Number(item.ratingCount ?? 0) || 0,
  userStars: normalizeStars(item.userStars),
});

export const formatRating = (averageRating: number | null | undefined, ratingCount: number | null | undefined): string =>
  averageRating != null && ratingCount ? `${averageRating.toFixed(1)} (${ratingCount})` : 'No ratings';

export const formatStarMarks = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
