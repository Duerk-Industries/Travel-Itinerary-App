import { resolveCatalogCoordinates } from './geocodingService';
import { reusableCatalogPlace } from './planningOperations';
import { normalizeDestinationKey } from './attractionsCatalogService';
import { listFlights, listLodgings, listActivities, listCarRentals, getTripById, listAttractionCatalogEntries } from '../db';
import type { Flight } from '../types';
import { findBundledAirport } from './airportCatalog';
import { selectPlanningDayPoints } from '../utils/planningMapPoints';
export const withAirportCoordinates = (flight: Flight): Flight => {
  const departure = findBundledAirport(flight.departureAirportCode);
  const arrival = findBundledAirport(flight.arrivalAirportCode);
  return { ...flight, departureLat: departure?.lat, departureLng: departure?.lng, arrivalLat: arrival?.lat, arrivalLng: arrival?.lng };
};
export const getPlanningDayPoints = async (userId: string, tripId: string, date: string) => {
  const [flights, lodgings, activities, carRentals] = await Promise.all([
    listFlights(userId, tripId), listLodgings(userId, tripId), listActivities(userId, tripId), listCarRentals(userId, tripId),
  ]);
  const points = selectPlanningDayPoints({ date, flights: flights.map(withAirportCoordinates), lodgings: lodgings.map(item => ({ ...item, check_in_date: item.check_in_date ?? (item as any).checkInDate, check_out_date: item.check_out_date ?? (item as any).checkOutDate })), activities, carRentals });
  // Resolve the current item's catalog identity on every read. No background write
  // can overwrite an edited address, manual coordinate, or a deleted trip item.
  if (!points.some(p => p.kind === 'activity' && (p.lat == null || p.lng == null))) return points;
  try {
    const trip = await getTripById(tripId);
    if (!trip?.destination) return points;
    const catalog = await listAttractionCatalogEntries(userId, normalizeDestinationKey(trip.destination), 2000);
    for (const point of points.filter(p => p.kind === 'activity' && (p.lat == null || p.lng == null)).slice(0, 10)) {
      const activity = activities.find(a => a.id === point.id);
      const place = catalog.find(p => activity?.catalogId ? p.id === activity.catalogId : p.name.toLowerCase().trim() === point.title.toLowerCase().trim());
      if (!place || place.name.toLowerCase().trim() !== point.title.toLowerCase().trim()) continue;
      if (point.address && ![place.name, place.destinationDisplayName].some(value => value.toLowerCase().trim() === point.address!.toLowerCase().trim())) continue;
      if (reusableCatalogPlace(place)) Object.assign(point, { lat: place.lat, lng: place.lon, geoCity: place.destinationDisplayName, coordinateSource: 'catalog' });
      else {
        const resolved = await resolveCatalogCoordinates(place);
        if (resolved) Object.assign(point, { lat: resolved.lat, lng: resolved.lng, geoCity: resolved.geoCity, coordinateSource: 'geocoder', coordinateAttribution: resolved.attribution, coordinateProvider: resolved.provider });
      }
    }
  } catch { /* Optional lookup never blocks the itinerary or item save. */ }
  return points;
};
