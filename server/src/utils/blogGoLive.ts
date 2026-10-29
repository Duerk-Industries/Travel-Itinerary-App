// A trip's blog goes public when the trip starts. Trips carry no timezone (see blogBackgroundWorker.ts),
// so "starts" is evaluated one day ahead of UTC: a traveler already on the first morning of the trip
// in a timezone east of UTC never sees their own day 1 held back. A trip with no start date is never held.
const DAY_MS = 86_400_000;

const dateOnly = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof (value as { toDate?: unknown }).toDate === 'function') return dateOnly((value as { toDate: () => Date }).toDate());
  const text = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

export const hasTripStarted = (startDate: unknown, now: Date = new Date()): boolean => {
  const start = dateOnly(startDate);
  if (!start) return true;
  return start <= new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
};

export const tripGoLiveDate = (startDate: unknown): string | null => dateOnly(startDate);
