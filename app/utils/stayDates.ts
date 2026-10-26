// Readable lodging dates for the itinerary day view: "Thu, Oct 29 → Mon, Nov 2 · 4 nights".
// Dates are parsed as local calendar dates (never via new Date("YYYY-MM-DD"), which is UTC and
// shows the previous day in US time zones). Full timestamps are reduced to their date first.
import { normalizeDateString } from './normalizeDateString';

const toLocalDate = (value?: string | null): Date | null => {
  const iso = normalizeDateString(String(value ?? '').trim());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};

const shortDay = (date: Date): string =>
  date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const formatStayRange = (checkIn?: string | null, checkOut?: string | null): string => {
  const start = toLocalDate(checkIn);
  const end = toLocalDate(checkOut);
  if (!start) return String(checkIn ?? '');
  if (!end) return shortDay(start);
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const nightLabel = nights > 0 ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : '';
  return `${shortDay(start)} → ${shortDay(end)}${nightLabel}`;
};

/** "Check-in today" / "Check-out today" on those days of the stay, otherwise null. */
export const stayDayNote = (checkIn?: string | null, checkOut?: string | null, day?: string | null): string | null => {
  const d = normalizeDateString(String(day ?? ''));
  if (!d) return null;
  if (normalizeDateString(String(checkIn ?? '')) === d) return 'Check-in today';
  if (normalizeDateString(String(checkOut ?? '')) === d) return 'Check-out today';
  return null;
};
