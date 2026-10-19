import { listFlights, listLodgings, listActivities, listCarRentals } from '../db';
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
  return selectPlanningDayPoints({ date, flights: flights.map(withAirportCoordinates), lodgings: lodgings.map(item => ({ ...item, check_in_date: item.check_in_date ?? (item as any).checkInDate, check_out_date: item.check_out_date ?? (item as any).checkOutDate })), activities, carRentals });
};
