import type { Trip } from '../../server/src/types';

export type TripPeriod = 'Current' | 'Upcoming' | 'Unscheduled' | 'Past';
export type TripSchedule = Pick<Trip, 'startDate' | 'endDate' | 'durationDays' | 'startMonth' | 'startYear'>;

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function getTripPeriod(trip: TripSchedule, now = new Date()): TripPeriod {
  const today = dayKey(now);
  let start = trip.startDate?.slice(0, 10);
  let end = trip.endDate?.slice(0, 10);
  if (!start && trip.startYear && trip.startMonth) {
    start = dayKey(new Date(trip.startYear, trip.startMonth - 1, 1));
    end = dayKey(new Date(trip.startYear, trip.startMonth, 0));
  }
  if (!end && start && trip.durationDays && trip.durationDays > 0) {
    const date = new Date(`${start}T12:00:00`);
    date.setDate(date.getDate() + trip.durationDays - 1);
    if (!Number.isNaN(date.getTime())) end = dayKey(date);
  }
  if (!start && !end) return 'Unscheduled';
  end ??= start;
  if (end && today > end) return 'Past';
  if (start && today >= start) return 'Current';
  return 'Upcoming';
}
