import type { Activity, Lodging, Trip } from '../../server/src/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayTime = (value?: string | null): number => {
  const day = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : NaN;
};

/** An undated activity is a single option until it is scheduled on a trip day. */
export function optionalActivitiesForDay<T extends Pick<Activity, 'date' | 'nearLodgingId'> & { status?: string }>(
  activities: T[],
  lodgings: Array<Pick<Lodging, 'id'> & { checkInDate: Lodging['check_in_date']; checkOutDate: Lodging['check_out_date']; status?: string }>,
  date: string | null,
  trip: Pick<Trip, 'startDate' | 'endDate'>,
): T[] {
  const day = dayTime(date);
  if (!Number.isFinite(day)) return [];
  const start = dayTime(trip.startDate);
  const end = dayTime(trip.endDate);
  if ((Number.isFinite(start) && day < start) || (Number.isFinite(end) && day > end)) return [];
  return activities.filter((activity) => {
    if (activity.date || activity.status === 'Cancelled') return false;
    if (!activity.nearLodgingId) return true;
    const lodging = lodgings.find((hotel) => hotel.id === activity.nearLodgingId && hotel.status !== 'Cancelled');
    if (!lodging) return false;
    const checkIn = dayTime(lodging.checkInDate);
    const checkOut = dayTime(lodging.checkOutDate);
    return checkOut >= checkIn && day >= checkIn - DAY_MS && day <= checkOut + DAY_MS;
  });
}
