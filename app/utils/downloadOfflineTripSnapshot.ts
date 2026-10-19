import type { PlanningBundle, Trip } from '../../server/src/types';
import { fetchFlightsForTrip, normalizeFlightFromApi } from '../tabs/transfers';
import { fetchActivitiesForTrip, normalizeActivityFromApi } from '../tabs/activities';
import { fetchLodgingsApi, normalizeLodgingFromApi } from '../tabs/lodging';
import { fetchCarRentalsForTrip, normalizeCarRentalFromApi } from '../tabs/carRentals';
import type { OfflineTripSnapshot, OfflineItinerarySnapshot } from './offlineTripCache';

/** Ordinary screen state can contain defaults or data from the previous trip.
 * Only this complete download is eligible to replace a durable snapshot. */
export const downloadOfflineTripSnapshot = async (params: {
  trip: Pick<Trip, 'id' | 'groupId'>; backendUrl: string; token: string; costTrackingAllowed: boolean; previous?: OfflineTripSnapshot; useBundle?: boolean;
}): Promise<OfflineTripSnapshot> => {
  const { trip, backendUrl, token, costTrackingAllowed } = params;
  const tripId = encodeURIComponent(trip.id);
  if (params.useBundle) {
    const previous = params.previous?.tripId === trip.id && params.previous.bundleCostTracking === costTrackingAllowed ? params.previous : undefined;
    const response = await fetch(`${backendUrl}/api/trips/${tripId}/bundle`, { headers: {
      Authorization: `Bearer ${token}`, ...(previous?.bundleEtag ? { 'If-None-Match': previous.bundleEtag } : {}),
    } });
    if (response.status === 304) {
      if (!previous?.bundleEtag) throw new Error('Saved copy is unavailable');
      return { ...previous, savedAt: Date.now() };
    }
    if (response.ok) {
      const bundle = await response.json() as PlanningBundle;
      if (bundle.schemaVersion !== 1 || bundle.tripId !== trip.id || bundle.representation?.costTracking !== costTrackingAllowed
        || !bundle.trip || !['groupMembers', 'flights', 'lodgings', 'tours', 'carRentals', 'expenses', 'payments'].every(key => Array.isArray((bundle as any)[key]))
        || !bundle.coveredBy || (bundle.itinerary !== null && !Array.isArray(bundle.itinerary?.details))) throw new Error('Invalid saved trip bundle');
      return { ...bundle, savedAt: Date.now(), bundleEtag: response.headers.get('ETag') ?? undefined,
        bundleCostTracking: costTrackingAllowed, flights: bundle.flights.map(normalizeFlightFromApi),
        lodgings: bundle.lodgings.map(normalizeLodgingFromApi), tours: bundle.tours.map(normalizeActivityFromApi), carRentals: bundle.carRentals.map(normalizeCarRentalFromApi) };
    }
    if (response.status !== 404) throw new Error('Saved trip download failed');
  }
  const fetchValue = async (path: string): Promise<unknown> => {
    const response = await fetch(`${backendUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Saved trip download failed');
    return response.json();
  };
  const fetchList = async (path: string): Promise<unknown[]> => {
    const data = await fetchValue(path);
    if (!Array.isArray(data)) throw new Error('Invalid trip list');
    return data;
  };
  const fetchRecord = async (path: string): Promise<Record<string, string>> => {
    const data = await fetchValue(path);
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.values(data).some(value => typeof value !== 'string')) throw new Error('Invalid trip record');
    return data as Record<string, string>;
  };
  const fetchItinerary = async (): Promise<OfflineItinerarySnapshot | null> => {
    const records = await fetchList('/api/itineraries');
    const matching = records.filter((record): record is Record<string, unknown> =>
      Boolean(record && typeof record === 'object' && (record as Record<string, unknown>).tripId === trip.id));
    if (!matching.length) return null;
    const latest = matching.sort((a, b) =>
      new Date(String(b.updatedAt ?? b.createdAt ?? 0)).getTime() - new Date(String(a.updatedAt ?? a.createdAt ?? 0)).getTime())[0];
    if (typeof latest.id !== 'string' || !latest.id) throw new Error('Invalid itinerary');
    return {
      id: latest.id, planMarkdown: typeof latest.planMarkdown === 'string' ? latest.planMarkdown : null,
      details: await fetchList(`/api/itineraries/${encodeURIComponent(latest.id)}/details`),
    };
  };
  const [groupMembers, flights, lodgings, tours, carRentals, expenses, payments, coveredBy, itinerary] = await Promise.all([
    fetchList(`/api/groups/${encodeURIComponent(trip.groupId)}/members`),
    fetchFlightsForTrip({ backendUrl, activeTripId: trip.id, token }),
    fetchLodgingsApi(backendUrl, trip.id, token),
    fetchActivitiesForTrip({ backendUrl, activeTripId: trip.id, token }),
    fetchCarRentalsForTrip({ backendUrl, activeTripId: trip.id, token }),
    costTrackingAllowed ? fetchList(`/api/expenses?tripId=${tripId}`) : Promise.resolve([]),
    costTrackingAllowed ? fetchList(`/api/payments?tripId=${tripId}`) : Promise.resolve([]),
    fetchRecord(`/api/trips/${tripId}/covered-by`), fetchItinerary(),
  ]);
  return { tripId: trip.id, trip, savedAt: Date.now(), groupMembers, flights, lodgings, tours, carRentals, expenses, payments, coveredBy, itinerary };
};
