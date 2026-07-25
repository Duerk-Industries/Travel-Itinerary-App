export type PageKey =
  | 'home'
  | 'overview'
  | 'blog'
  | 'flights'
  | 'lodging'
  | 'packing'
  | 'car'
  | 'tours'
  | 'expenses'
  | 'ledger'
  | 'ingest'
  | 'cost'
  | 'trips'
  | 'create-trip'
  | 'account'
  | 'follow'
  | 'following'
  | 'admin';

type PageGuardOptions = {
  isFollowedTrip?: boolean;
};

export const FOLLOWED_TRIP_HIDDEN_PAGES: PageKey[] = [
  'expenses',
  'ingest',
  'ledger',
  'trips',
  'create-trip',
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
    return nextPage === 'home';
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
    return tabPage !== 'home';
  }
  if (options.isFollowedTrip && followedTripHiddenPageSet.has(tabPage)) {
    return true;
  }
  return false;
};
