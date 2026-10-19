// Generated from packages/domain/src/planningMapPoints.ts by scripts/sync-planning-points.cjs.
import type { Activity, CarRental, Flight, Lodging, PlanningMapPoint } from '../types';
type Identified<T> = Partial<T> & { id: string };
export const selectPlanningDayPoints = (input: {
  date: string; flights: Identified<Flight>[]; lodgings: Identified<Lodging>[];
  activities: Identified<Activity>[]; carRentals: Identified<CarRental>[];
}): PlanningMapPoint[] => {
  const points: PlanningMapPoint[] = [];
  const day = input.date.slice(0, 10);
  const dateKey = (date: unknown): string => date instanceof Date ? date.toISOString().slice(0, 10) : String(date || '').slice(0, 10);
  const same = (date?: string | null): boolean => dateKey(date) === day;
  const active = (status?: string): boolean => status !== 'Cancelled';
  for (const flight of input.flights.filter(f => active(f.status))) {
    if (same(flight.departureDate)) points.push({ id: `${flight.id}:departure`, kind: 'flight', title: flight.departureLocation || flight.departureAirportCode || 'Departure', address: flight.departureLocation, lat: flight.departureLat, lng: flight.departureLng, coordinateSource: 'airport' });
    if (same(flight.arrivalDate || flight.departureDate)) points.push({ id: `${flight.id}:arrival`, kind: 'flight', title: flight.arrivalLocation || flight.arrivalAirportCode || 'Arrival', address: flight.arrivalLocation, lat: flight.arrivalLat, lng: flight.arrivalLng, coordinateSource: 'airport' });
  }
  for (const lodging of input.lodgings.filter(l => active(l.status) && l.check_in_date && l.check_out_date && dateKey(l.check_in_date) <= day && dateKey(l.check_out_date) >= day)) points.push({
    id: lodging.id, kind: 'lodging', title: lodging.name || 'Lodging', address: lodging.address,
    lat: lodging.lat, lng: lodging.lng, coordinateSource: lodging.coordinateSource,
  });
  const activities = input.activities.filter(a => active(a.status) && same(a.date)).sort((a, b) =>
    (a.dayPosition ?? Number.MAX_SAFE_INTEGER) - (b.dayPosition ?? Number.MAX_SAFE_INTEGER)
    || (a.startTime || '99:99').localeCompare(b.startTime || '99:99') || (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id));
  for (const activity of activities) points.push({ id: activity.id, kind: 'activity', title: activity.name || 'Activity', address: activity.startLocation, lat: activity.lat, lng: activity.lng, coordinateSource: activity.coordinateSource });
  for (const rental of input.carRentals.filter(r => active(r.status))) {
    if (same(rental.pickupDate)) points.push({ id: `${rental.id}:pickup`, kind: 'car_rental', title: rental.pickupLocation || 'Car pickup', address: rental.pickupLocation, lat: rental.lat, lng: rental.lng, coordinateSource: rental.coordinateSource });
    if (same(rental.dropoffDate)) points.push({ id: `${rental.id}:dropoff`, kind: 'car_rental', title: rental.dropoffLocation || 'Car dropoff', address: rental.dropoffLocation, lat: rental.dropoffLat, lng: rental.dropoffLng, coordinateSource: rental.coordinateSource });
  }
  return points.map((point, index) => ({ ...point, label: index < 26 ? String.fromCharCode(65 + index) : String(index + 1) }));
};
