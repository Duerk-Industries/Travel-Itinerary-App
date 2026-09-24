import { ensureUserInTrip, listActivities, listCarRentals, listFlights, listLodgings } from '../db';

export type BlogPlace = {
  name: string;
  firstDate: string | null;
  occurrences: number;
  sourceTypes: string[];
};

// C6 deliberately derives names from records the traveler already owns. It does not reverse
// geocode photo coordinates, so opening the index has no Google/provider cost and cannot reveal
// a private geotag through a new projection.
export const listBlogPlaces = async (tripId: string, actorUserId: string, limit: number): Promise<BlogPlace[]> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new Error('Not authorized to view trip places');
  const [flights, lodgings, activities, rentals] = await Promise.all([
    listFlights(actorUserId, tripId),
    listLodgings(actorUserId, tripId),
    listActivities(actorUserId, tripId),
    listCarRentals(actorUserId, tripId),
  ]);
  const places = new Map<string, BlogPlace>();
  const add = (raw: unknown, date: unknown, sourceType: string): void => {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const day = /^\d{4}-\d{2}-\d{2}/.test(String(date ?? '')) ? String(date).slice(0, 10) : null;
    const current = places.get(key);
    if (!current) {
      places.set(key, { name, firstDate: day, occurrences: 1, sourceTypes: [sourceType] });
      return;
    }
    current.occurrences += 1;
    if (day && (!current.firstDate || day < current.firstDate)) current.firstDate = day;
    if (!current.sourceTypes.includes(sourceType)) current.sourceTypes.push(sourceType);
  };
  for (const row of flights) {
    add(row.departureLocation, row.departureDate, 'flights');
    add(row.arrivalLocation, row.arrivalDate ?? row.departureDate, 'flights');
  }
  for (const row of lodgings) add(row.address || row.name, row.check_in_date, 'lodgings');
  for (const row of activities) add(row.startLocation || row.name, row.date, 'activities');
  for (const row of rentals) {
    add(row.pickupLocation, row.pickupDate, 'car_rentals');
    add(row.dropoffLocation, row.dropoffDate, 'car_rentals');
  }
  return [...places.values()]
    .sort((a, b) => String(a.firstDate ?? '9999').localeCompare(String(b.firstDate ?? '9999')) || a.name.localeCompare(b.name))
    .slice(0, limit);
};
