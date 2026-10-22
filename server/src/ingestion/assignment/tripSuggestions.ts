import type { PersistedParsedItem } from '../contracts';
import type { Trip } from '../../types';
import { matchItemToTrip } from './tripMatcher';

/** Compatibility pure wrapper. HTTP review uses the same matcher with hydrated authorized context. */
export const suggestTrips = (item: PersistedParsedItem, trips: Trip[]): Array<{ tripId: string; reasons: string[] }> =>
  matchItemToTrip(item, trips, { sourceTrusted: false, automaticAddingOn: false }).candidates.slice(0, 5)
    .map(({ tripId, reasons }) => ({ tripId, reasons }));
