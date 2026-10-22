// Generated from packages/domain/src/dayOrder.ts by scripts/sync-planning-points.cjs.
// Single definition of "the order of a day's activities", shared by the server (reorder concurrency
// check) and the app (list, map letters, optimizer). A stop's explicit day position wins; stops that
// were never placed fall back to start time, then name, then id so the order is total and stable.
export type DayOrderable = { id: string; dayPosition?: number | null; startTime?: string | null; name?: string | null };

// "9:30" and "09:30" are the same time; anything that is not H:MM (empty, "TBD") sorts last.
const timeKey = (value?: string | null): string => {
  const text = String(value ?? '').trim();
  return /^\d{1,2}:\d{2}$/.test(text) ? text.padStart(5, '0') : '99:99';
};

export const compareDayActivities = (a: DayOrderable, b: DayOrderable): number => {
  const position = (a.dayPosition ?? Number.MAX_SAFE_INTEGER) - (b.dayPosition ?? Number.MAX_SAFE_INTEGER);
  if (position !== 0) return position;
  return timeKey(a.startTime).localeCompare(timeKey(b.startTime))
    || (a.name || '').localeCompare(b.name || '')
    || a.id.localeCompare(b.id);
};

export const orderDayActivities = <T extends DayOrderable>(activities: readonly T[]): T[] =>
  [...activities].sort(compareDayActivities);
