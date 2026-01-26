export type PageKey =
  | 'menu'
  | 'overview'
  | 'flights'
  | 'lodging'
  | 'car'
  | 'tours'
  | 'cost'
  | 'trips'
  | 'create-trip'
  | 'trip-details'
  | 'itinerary'
  | 'account'
  | 'follow';

export const shouldAllowPageChange = (currentPage: PageKey, nextPage: PageKey): boolean => {
  if (currentPage === 'create-trip' && nextPage !== 'create-trip') {
    return false;
  }
  return true;
};

export const shouldDisableTab = (currentPage: PageKey, tabPage: PageKey): boolean => {
  return currentPage === 'create-trip' && tabPage !== 'create-trip';
};
