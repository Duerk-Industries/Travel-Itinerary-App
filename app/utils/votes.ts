import { normalizeItineraryStatus } from './itineraryStatus';

export const shouldShowVoteButtons = (status: unknown, userVote: number | null | undefined): boolean => {
  return normalizeItineraryStatus(status, 'Booked') === 'Proposed' && !(userVote === 1 || userVote === -1);
};

export const shouldShowRatingButtons = (status: unknown, userRating: number | null | undefined): boolean => {
  return normalizeItineraryStatus(status, 'Booked') === 'Completed' && !(userRating === 1 || userRating === -1);
};

export const formatNetVotes = (value: unknown): string => {
  const net = Number(value) || 0;
  return net > 0 ? `+${net}` : String(net);
};
