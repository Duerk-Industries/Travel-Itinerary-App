import type { PersistedParsedItem } from '../contracts';
import type { Trip } from '../../types';
import { dateOnly } from './tripMatcher';

/** Suggestions use only writable candidate trips and extracted booking facts.
 * Never interpret instructions, a trip id, or a score supplied by a model. */
export const suggestTrips = (item: PersistedParsedItem, trips: Trip[]): Array<{ tripId: string; reasons: string[] }> => {
  const start = dateOnly(item.startDateTimeUtc);
  const end = dateOnly(item.endDateTimeUtc) || start;
  if (!start || !end || item.timezoneStatus !== 'RESOLVED') return [];
  const fields = item.extractedFields;
  const destination = [fields.arrivalLocation, fields.arrivalCity, fields.address, fields.startLocation, fields.propertyName].filter(value => typeof value === 'string').join(' ').toLowerCase();
  return trips.filter(trip => dateOnly(trip.startDate) && dateOnly(trip.endDate) && dateOnly(trip.startDate)! <= end && dateOnly(trip.endDate)! >= start)
    .map(trip => {
      const reasons = ['Booking dates overlap this trip'];
      // Departure/origin is deliberately excluded from geographic evidence.
      const tokens = (trip.destination || '').toLowerCase().split(/[,;]/).map(value => value.trim()).filter(value => value.length >= 3);
      if (tokens.some(token => destination.includes(token))) reasons.push('Booking location matches the destination');
      return { tripId: trip.id, reasons };
    }).sort((a, b) => b.reasons.length - a.reasons.length || a.tripId.localeCompare(b.tripId)).slice(0, 5);
};
