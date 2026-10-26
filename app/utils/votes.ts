import { normalizeItineraryStatus } from './itineraryStatus';

// Kept for older callers; proposal voting has been retired.
export const shouldShowVoteButtons = (_status: unknown, _userVote: number | null | undefined): boolean => false;

export const shouldShowRatingButtons = (status: unknown, userRating: number | null | undefined): boolean => {
  return normalizeItineraryStatus(status, 'Booked') === 'Completed' && !(userRating === 1 || userRating === -1);
};

export const formatNetVotes = (value: unknown): string => {
  const net = Number(value) || 0;
  return net > 0 ? `+${net}` : String(net);
};
