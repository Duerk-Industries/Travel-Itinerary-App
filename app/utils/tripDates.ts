export type TripDateMode = 'range' | 'month';
const DAY_MS = 24 * 60 * 60 * 1000;
// Lazy + defensive: any failure in the Intl constructor on a constrained
// runtime falls back to a manual formatter so this module can't fail to load.
type DateFormatter = { format: (date: Date) => string };
let _monthYearFormatter: DateFormatter | null = null;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const buildFallbackMonthYearFormatter = (): DateFormatter => ({
  format: (date) => `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`,
});
const getMonthYearFormatter = (): DateFormatter => {
  if (_monthYearFormatter) return _monthYearFormatter;
  try {
    _monthYearFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  } catch {
    _monthYearFormatter = buildFallbackMonthYearFormatter();
  }
  return _monthYearFormatter;
};

export const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
};

export const computeDurationFromRange = (startDate?: string | null, endDate?: string | null): number | null => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  const diff = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return diff > 0 ? diff : null;
};

export const computeEndDateFromDuration = (startDate: string, days: number): string | null => {
  const start = parseDate(startDate);
  if (!start || !Number.isFinite(days) || days <= 0) return null;
  const end = new Date(start.getTime() + (days - 1) * DAY_MS);
  return end.toISOString().slice(0, 10);
};

export const formatMonthYear = (month?: number | null, year?: number | null): string | null => {
  if (!month || !year) return null;
  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.valueOf())) return null;
  return getMonthYearFormatter().format(date);
};

export const adjustStartDateForEarliest = (params: {
  startDate?: string | null;
  endDate?: string | null;
  earliestDate?: string | null;
}): { startDate?: string | null; endDate?: string | null } => {
  const { startDate, endDate, earliestDate } = params;
  const start = parseDate(startDate);
  const earliest = parseDate(earliestDate);
  if (!start || !earliest || earliest >= start) return { startDate, endDate };
  const duration = computeDurationFromRange(startDate, endDate);
  const shiftedStart = earliest.toISOString().slice(0, 10);
  const shiftedEnd = duration ? computeEndDateFromDuration(shiftedStart, duration) : endDate ?? null;
  return { startDate: shiftedStart, endDate: shiftedEnd };
};

export const getEarliestTripEventDate = (dates: Array<string | undefined | null>): string | null => {
  let earliestMs: number | null = null;
  for (const value of dates) {
    const parsed = parseDate(value);
    if (!parsed) continue;
    const ms = parsed.getTime();
    if (earliestMs === null || ms < earliestMs) {
      earliestMs = ms;
    }
  }
  if (earliestMs === null) return null;
  return new Date(earliestMs).toISOString().slice(0, 10);
};
