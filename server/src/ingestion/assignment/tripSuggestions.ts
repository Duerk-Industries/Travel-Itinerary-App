import type { PersistedParsedItem } from '../contracts';
import type { Trip } from '../../types';

/** Suggestions use only writable candidate trips and extracted booking facts.
 * Never interpret instructions, a trip id, or a score supplied by a model. */
export const suggestTrips = (item: PersistedParsedItem, trips: Trip[]): Array<{ tripId: string; reasons: string[] }> => {
  const start = item.startDateTimeUtc?.slice(0, 10);
  const end = item.endDateTimeUtc?.slice(0, 10) || start;
  if (!start || !end || item.timezoneStatus !== 'RESOLVED') return [];
  const fields = item.extractedFields;
  const destination = [fields.arrivalLocation, fields.arrivalCity, fields.address, fields.startLocation, fields.propertyName].filter(value => typeof value === 'string').join(' ').toLowerCase();
  return trips.filter(trip => trip.startDate && trip.endDate && trip.startDate.slice(0, 10) <= end && trip.endDate.slice(0, 10) >= start)
    .map(trip => {
      const reasons = ['Booking dates overlap this trip'];
      // Departure/origin is deliberately excluded from geographic evidence.
      const tokens = (trip.destination || '').toLowerCase().split(/[,;]/).map(value => value.trim()).filter(value => value.length >= 3);
      if (tokens.some(token => destination.includes(token))) reasons.push('Booking location matches the destination');
      return { tripId: trip.id, reasons };
    }).sort((a, b) => b.reasons.length - a.reasons.length || a.tripId.localeCompare(b.tripId)).slice(0, 5);
};
