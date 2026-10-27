import { castItemVote, ensureUserInTrip, listActivities, listCarRentals, listFlights, listLodgings } from '../db';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';

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

const placeKey = (raw: unknown): string => String(raw ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export type PlaceRatingResult = {
  /** Activities and stays that go by this place name. */
  matched: number;
  /** How many of them took the thumb. Only Completed items can be rated. */
  rated: number;
  /** Matched items that are not Completed yet, so the thumb could not be recorded on them. */
  notCompleted: number;
  /** The place's first date, for filing a note against the right day. */
  firstDate: string | null;
};

/**
 * The thumb half of "Rate this place". A place is the name the places list shows (an activity's
 * start location or name, a stay's address or name), so the rating lands on the activities and stays
 * that go by that name. It follows the same rule as rating them one at a time: Completed items only.
 */
export const ratePlace = async (tripId: string, actorUserId: string, placeName: string, value: 1 | -1): Promise<PlaceRatingResult> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new Error('Not authorized to rate trip places');
  const wanted = placeKey(placeName);
  if (!wanted) throw new Error('A place is required');
  const [activities, lodgings] = await Promise.all([listActivities(actorUserId, tripId), listLodgings(actorUserId, tripId)]);
  const matches: Array<{ type: 'activity' | 'lodging'; id: string; status: unknown; date: string | null }> = [];
  for (const row of activities as any[]) {
    if (placeKey(row.startLocation || row.name) === wanted) matches.push({ type: 'activity', id: String(row.id), status: row.status, date: /^\d{4}-\d{2}-\d{2}/.test(String(row.date ?? '')) ? String(row.date).slice(0, 10) : null });
  }
  for (const row of lodgings as any[]) {
    if (placeKey(row.address || row.name) === wanted) matches.push({ type: 'lodging', id: String(row.id), status: row.status, date: /^\d{4}-\d{2}-\d{2}/.test(String(row.check_in_date ?? '')) ? String(row.check_in_date).slice(0, 10) : null });
  }
  let rated = 0;
  for (const match of matches) {
    if (normalizeItineraryStatus(match.status as any) !== 'Completed') continue;
    await castItemVote(actorUserId, tripId, match.type, match.id, value, 'rating');
    rated += 1;
  }
  const dates = matches.map((match) => match.date).filter((date): date is string => Boolean(date)).sort();
  return { matched: matches.length, rated, notCompleted: matches.length - rated, firstDate: dates[0] ?? null };
};
