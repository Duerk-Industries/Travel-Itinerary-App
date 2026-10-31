import { normalizeItineraryStatus } from './itineraryStatus';

// Kept for older callers; proposal voting has been retired.
export const shouldShowVoteButtons = (_status: unknown, _userVote: number | null | undefined): boolean => false;

/** Only a finished (Completed) booking can be rated; the rating can be changed afterwards. */
export const canRateItem = (status: unknown): boolean => normalizeItineraryStatus(status, 'Booked') === 'Completed';

export const MAX_STARS = 5;

/** The traveler's own rating as whole stars 1 to 5, or null when they have not rated it. */
export const normalizeStarRating = (value: unknown): number | null => {
  const stars = Number(value);
  return Number.isInteger(stars) && stars >= 1 && stars <= MAX_STARS ? stars : null;
};

/** The average rating across travelers (0 to 5, fractions allowed), or null when nobody has rated it. */
export const normalizeAverageRating = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const average = Number(value);
  return Number.isFinite(average) && average > 0 ? Math.min(MAX_STARS, average) : null;
};

/** "4.3", or "-" when nobody has rated it. */
export const formatAverageRating = (value: unknown): string => {
  const average = normalizeAverageRating(value);
  return average === null ? '-' : average.toFixed(1);
};

/** The rating fields of a server item, tolerating an older server that sends none of them. */
export const normalizeRatingFields = (item: any) => ({
  averageRating: normalizeAverageRating(item.averageRating),
  ratingCount: Number(item.ratingCount ?? 0) || 0,
  userStars: normalizeStarRating(item.userStars),
});

export const formatRating = (averageRating: number | null | undefined, ratingCount: number | null | undefined): string =>
  averageRating != null && ratingCount ? `${averageRating.toFixed(1)} (${ratingCount})` : 'No ratings';

export const formatStarMarks = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
