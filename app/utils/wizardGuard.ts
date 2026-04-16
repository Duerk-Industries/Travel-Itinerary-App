export type PageKey =
  | 'home'
  | 'overview'
  | 'flights'
  | 'lodging'
  | 'car'
  | 'tours'
  | 'expenses'
  | 'ledger'
  | 'ingest'
  | 'cost'
  | 'trips'
  | 'create-trip'
  | 'trip-details'
  | 'itinerary'
  | 'account'
  | 'follow'
  | 'following'
  | 'admin';

type PageGuardOptions = {
  isFollowedTrip?: boolean;
};

export const FOLLOWED_TRIP_HIDDEN_PAGES: PageKey[] = [
  'itinerary',
  'expenses',
  'ingest',
  'trips',
  'create-trip',
  'account',
  'follow',
  'following',
];

const followedTripHiddenPageSet = new Set<PageKey>(FOLLOWED_TRIP_HIDDEN_PAGES);

export const shouldAllowPageChange = (
  currentPage: PageKey,
  nextPage: PageKey,
  options: PageGuardOptions = {}
): boolean => {
  if (currentPage === 'create-trip' && nextPage !== 'create-trip') {
    return false;
  }
  if (options.isFollowedTrip && followedTripHiddenPageSet.has(nextPage)) {
    return false;
  }
  return true;
};

export const shouldDisableTab = (
  currentPage: PageKey,
  tabPage: PageKey,
  options: PageGuardOptions = {}
): boolean => {
  if (currentPage === 'create-trip' && tabPage !== 'create-trip') {
    return true;
  }
  if (options.isFollowedTrip && followedTripHiddenPageSet.has(tabPage)) {
    return true;
  }
  return false;
};
