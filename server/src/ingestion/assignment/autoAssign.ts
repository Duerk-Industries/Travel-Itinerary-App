import { listTrips } from '../../db';
import { getDestinationLocationOptionsByIds } from '../../services/destinationAttractionAutocompleteService';
import { getLocationOptionsByIds } from '../../services/locationServices';
import { logError, logInfo } from '../../logger';
import { isFeatureEnabled } from '../../services/entitlementService';
import { notify } from '../../services/notificationService';
import type { PersistedParsedItem } from '../contracts';
import {
  AUTO_UNDO_WINDOW_MS,
  assignParsedItemToTrip,
  getAutoAssignPreference,
  listTripBookingReferences,
} from '../shared/repository';
import { dateOnly, matchItemToTrip, type MatchDecision, type MatchTrip } from './tripMatcher';

/** Master switch for writing matched bookings into trips. Fail-closed: off until deliberately turned on. */
export const AUTO_ASSIGN_FLAG = 'planning_auto_assign';

/**
 * Sources where the signed-in owner personally handed us the document (their own upload or share).
 * Forwarded email is NOT here: anyone who learns an address could send to it, so it only ever suggests
 * until forwarder verification exists. Provider-authenticated sources (Gmail import) are not included either.
 */
const TRUSTED_SOURCES = new Set<PersistedParsedItem['sourceType']>(['MANUAL_UPLOAD']);

/**
 * Whether automatic adding applies to this person: the release switch is on AND they have not turned it off.
 * Someone who never chose gets the default, which is on, so nobody has to find a setting.
 */
export const automaticAddingEnabledFor = async (userId: string): Promise<boolean> => {
  if (!(await isFeatureEnabled(AUTO_ASSIGN_FLAG, userId))) return false;
  return (await getAutoAssignPreference(userId)) ?? true;
};

type TripPlaces = { cities: string[]; broad: string[] };

/**
 * Trips created through the app never store a destination sentence; where they are going lives in the
 * place ids the person picked. Resolve those to names so a booking can be matched to the trip by place.
 * Cities (and named destinations) are specific enough to count; countries and states are not.
 */
export const resolveTripPlaces = async (locationIds: unknown): Promise<TripPlaces> => {
  const ids = Array.isArray(locationIds) ? locationIds.map(String).filter(Boolean).slice(0, 20) : [];
  if (!ids.length) return { cities: [], broad: [] };
  const [options, destinations] = await Promise.all([
    getLocationOptionsByIds(ids).catch(() => []),
    getDestinationLocationOptionsByIds(ids).catch(() => []),
  ]);
  const cities = new Set<string>();
  const broad = new Set<string>();
  for (const option of options) (option.sourceType === 'city' ? cities : broad).add(option.name);
  for (const destination of destinations) {
    cities.add(destination.name);
    if (destination.nearestCity) cities.add(destination.nearestCity);
    if (destination.countryName) broad.add(destination.countryName);
  }
  return { cities: [...cities], broad: [...broad] };
};

const toMatchTrip = (
  trip: { id: string; name: string; destination?: string | null; startDate?: unknown; endDate?: unknown },
  refs: readonly string[] = [],
  places: TripPlaces = { cities: [], broad: [] },
): MatchTrip => ({
  id: trip.id,
  name: trip.name,
  destination: [trip.destination, ...places.cities].filter(Boolean).join(', ') || null,
  broadPlaces: places.broad,
  startDate: dateOnly(trip.startDate),
  endDate: dateOnly(trip.endDate),
  bookingReferences: refs,
});

/**
 * Decides where one booking belongs. Candidate trips are only the ones this person is an active member of
 * (listTrips), and booking numbers are only looked up for trips that already fit on dates.
 */
export const decideTripForItem = async (item: PersistedParsedItem, userId: string, automaticAddingOn: boolean): Promise<MatchDecision & { tripName: string | null }> => {
  const trips = await listTrips(userId);
  const base = trips.map((trip) => toMatchTrip(trip));
  const options = { sourceTrusted: TRUSTED_SOURCES.has(item.sourceType), automaticAddingOn };
  let decision = matchItemToTrip(item, base, options);
  if (decision.candidates.length) {
    // Only for the few trips that already fit on dates: where they are going, and booking numbers already in them.
    const ids = decision.candidates.map((candidate) => candidate.tripId);
    const [refs, places] = await Promise.all([
      listTripBookingReferences(ids),
      Promise.all(trips.filter((trip) => ids.includes(trip.id)).map(async (trip) => [trip.id, await resolveTripPlaces((trip as { locationIds?: unknown }).locationIds)] as const)),
    ]);
    const placesById = new Map(places);
    decision = matchItemToTrip(item, trips.map((trip) => toMatchTrip(trip, refs.get(trip.id) ?? [], placesById.get(trip.id))), options);
  }
  const tripName = trips.find((trip) => trip.id === decision.tripId)?.name ?? null;
  return { ...decision, tripName };
};

export type AutoAssignResult = { itemId: string; tripId: string; tripName: string | null; reasons: string[] };

/**
 * Runs after extraction. Adds each qualifying booking to its trip and tells the person, with Undo.
 * Never throws and never blocks the import: anything that goes wrong leaves the item in the review queue
 * exactly as it would have been without this feature.
 */
export const applyAutomaticAssignments = async (params: { userId: string; items: PersistedParsedItem[] }): Promise<AutoAssignResult[]> => {
  const added: AutoAssignResult[] = [];
  let on = false;
  try {
    on = await automaticAddingEnabledFor(params.userId);
  } catch (error) {
    logError('[ingestion][auto-assign] could not read the setting; leaving items for review', error);
    return added;
  }
  if (!on) return added;

  for (const item of params.items) {
    if (item.status !== 'READY_FOR_REVIEW') continue;
    try {
      const decision = await decideTripForItem(item, params.userId, true);
      if (decision.decision !== 'auto' || !decision.tripId) continue;
      await assignParsedItemToTrip(params.userId, item.id, decision.tripId, params.userId, {
        mode: 'AUTO',
        undoWindowMs: AUTO_UNDO_WINDOW_MS,
        reasons: decision.reasons,
      });
      added.push({ itemId: item.id, tripId: decision.tripId, tripName: decision.tripName, reasons: decision.reasons });
      logInfo(`[ingestion][auto-assign] added item=${item.id} trip=${decision.tripId}`);
      await notify({
        userIds: [params.userId],
        category: 'import_result',
        tripId: decision.tripId,
        actorUserId: params.userId,
        title: `Added to ${decision.tripName ?? 'your trip'}`,
        body: 'A booking you imported was added automatically. You can take it back for 7 days.',
        deepLink: `wanderbunnies://imports?itemId=${encodeURIComponent(item.id)}`,
        payload: { type: 'import_result', itemId: item.id, tripId: decision.tripId, action: 'auto_added' },
        dedupeKey: `import-auto:${item.id}`,
      }).catch((error) => logError('[ingestion][auto-assign] notification failed', error));
    } catch (error) {
      // The booking stays in the review queue; the person can still add it themselves.
      logError(`[ingestion][auto-assign] left item=${item.id} for review`, error);
    }
  }
  return added;
};
