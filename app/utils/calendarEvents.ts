import { normalizeTimeInput } from './normalizeTimeInput';
import type { Activity, Flight, Lodging, CarRental } from '../../server/src/types';

export type CalendarApp = 'google' | 'apple';
export const isCalendarApp = (value: unknown): value is CalendarApp => value === 'google' || value === 'apple';
export const calendarAppOptions: Array<{ key: CalendarApp; label: string }> = [
  { key: 'google', label: 'Google Calendar' }, { key: 'apple', label: 'Apple Calendar' },
];

// Floating local times preserve the booking's wall-clock time. Our trip items do
// not yet store a time zone per endpoint (flights can cross time zones).
export type CalendarEvent = {
  id: string; title: string; start: string; end: string; allDay: boolean;
  location?: string; description?: string;
};

const validDay = (value: string): string | null => {
  const day = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!day) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
};
const addMinutes = (value: string, minutes: number) =>
  new Date(new Date(`${value}Z`).getTime() + minutes * 60000).toISOString().slice(0, 19);

export function makeCalendarEvent(input: {
  id: string; title: string; date: string; time?: string; endDate?: string; endTime?: string;
  durationMinutes?: number; location?: string; description?: string;
}): CalendarEvent | null {
  const day = validDay(input.date);
  if (!day) return null;
  const time = normalizeTimeInput(input.time);
  // An invalid supplied time must never silently become an all-day event.
  if (input.time?.trim() && !time) return null;
  const allDay = !time;
  const start = allDay ? day : `${day}T${time}:00`;
  const endDay = validDay(input.endDate || '');
  const endTime = normalizeTimeInput(input.endTime);
  const candidate = allDay ? endDay : endDay && endTime ? `${endDay}T${endTime}:00` : null;
  const end = candidate && candidate > start ? candidate : allDay
    ? addMinutes(`${day}T00:00:00`, 1440).slice(0, 10)
    : addMinutes(start, input.durationMinutes && Number.isFinite(input.durationMinutes) && input.durationMinutes > 0 && input.durationMinutes <= 525600 ? input.durationMinutes : 60);
  const description = [input.description, !allDay && 'Check the event time zone before saving. Times are recorded as local booking times.'].filter(Boolean).join('\n');
  return { id: input.id, title: input.title, start, end, allDay, location: input.location, description };
}

function durationMinutes(value: string): number | undefined {
  const text = value.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  return hours || minutes ? Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0) : undefined;
}

export const activityCalendarEvent = (item: Pick<Activity, 'id' | 'name' | 'date' | 'startTime' | 'duration' | 'startLocation' | 'notes' | 'reference'>) =>
  makeCalendarEvent({ id: `activity-${item.id}`, title: item.name || 'Activity', date: item.date, time: item.startTime,
    durationMinutes: durationMinutes(item.duration), location: item.startLocation,
    description: [item.notes, item.reference && `Reference: ${item.reference}`].filter(Boolean).join('\n') });

export const transferCalendarEvent = (item: Pick<Flight, 'id' | 'departureDate' | 'departureTime' | 'arrivalDate' | 'arrivalTime' | 'departureLocation' | 'departureAirportCode' | 'arrivalLocation' | 'arrivalAirportCode' | 'carrier' | 'flightNumber' | 'bookingReference'>) =>
  makeCalendarEvent({ id: `transfer-${item.id}`,
    title: `${item.carrier || 'Transfer'} ${item.flightNumber || ''}: ${item.departureLocation || item.departureAirportCode || 'Departure'} → ${item.arrivalLocation || item.arrivalAirportCode || 'Arrival'}`.trim(),
    date: item.departureDate, time: item.departureTime, endDate: item.arrivalDate || item.departureDate, endTime: item.arrivalTime,
    location: item.departureLocation || item.departureAirportCode,
    description: `Arrival: ${item.arrivalDate || item.departureDate} ${item.arrivalTime || 'TBD'}\n${item.bookingReference ? `Reference: ${item.bookingReference}\n` : ''}Verify departure and arrival time zones before saving.` });

export const uiTransferCalendarEvent = (item: import('../tabs/transfers').Flight) => transferCalendarEvent({
  id: item.id, departureDate: item.departure_date, departureTime: item.departure_time,
  arrivalDate: item.arrival_date, arrivalTime: item.arrival_time,
  departureLocation: item.departure_location, departureAirportCode: item.departure_airport_code,
  arrivalLocation: item.arrival_location, arrivalAirportCode: item.arrival_airport_code,
  carrier: item.carrier, flightNumber: item.flight_number, bookingReference: item.booking_reference,
});

// Use canonical fields at this boundary; the UI's existing lodging model uses camelCase.
export const lodgingCalendarEvent = (item: Pick<Lodging, 'id' | 'name' | 'check_in_date' | 'check_out_date' | 'address' | 'notes'>) =>
  makeCalendarEvent({ id: `lodging-${item.id}`, title: item.name || 'Lodging', date: item.check_in_date,
    endDate: item.check_out_date, location: item.address, description: item.notes || undefined });

export const rentalCalendarEvent = (item: Pick<CarRental, 'id' | 'vendor' | 'pickupDate' | 'dropoffDate' | 'pickupLocation' | 'dropoffLocation' | 'reference' | 'notes'>) =>
  makeCalendarEvent({ id: `rental-${item.id}`, title: `Car rental: ${item.vendor || 'Rental car'}`, date: item.pickupDate,
    endDate: item.dropoffDate, location: item.pickupLocation,
    description: [`Dropoff: ${item.dropoffLocation}`, item.reference && `Reference: ${item.reference}`, item.notes].filter(Boolean).join('\n') });

const compact = (value: string) => value.replace(/[-:]/g, '');
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title,
    dates: `${compact(event.start)}/${compact(event.end)}`, location: event.location || '',
    details: event.description || '' });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const escapeIcs = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
// RFC 5545 folds at 75 UTF-8 octets, without splitting a Unicode character.
const foldLine = (line: string) => {
  let result = ''; let length = 0;
  for (const char of line) {
    const bytes = char.codePointAt(0)! <= 0x7f ? 1 : char.codePointAt(0)! <= 0x7ff ? 2 : char.codePointAt(0)! <= 0xffff ? 3 : 4;
    if (length + bytes > 75) { result += '\r\n '; length = 1; }
    result += char; length += bytes;
  }
  return result;
};
export function buildCalendarIcs(event: CalendarEvent, now = new Date()): string {
  const suffix = event.allDay ? ';VALUE=DATE' : '';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WanderBunnies//Trip Calendar//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${escapeIcs(event.id)}@wanderbunnies`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    `DTSTART${suffix}:${compact(event.start)}`, `DTEND${suffix}:${compact(event.end)}`, `SUMMARY:${escapeIcs(event.title)}`,
    `LOCATION:${escapeIcs(event.location || '')}`, `DESCRIPTION:${escapeIcs(event.description || '')}`, 'END:VEVENT', 'END:VCALENDAR']
    .map(foldLine).join('\r\n') + '\r\n';
}
