export type TripDateMode = 'range' | 'month';

export const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
};

export const computeDurationFromRange = (startDate?: string | null, endDate?: string | null): number | null => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  const diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : null;
};

export const computeEndDateFromDuration = (startDate: string, days: number): string | null => {
  const start = parseDate(startDate);
  if (!start || !Number.isFinite(days) || days <= 0) return null;
  const end = new Date(start.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
  return end.toISOString().slice(0, 10);
};

export const formatMonthYear = (month?: number | null, year?: number | null): string | null => {
  if (!month || !year) return null;
  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
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
  const parsed = dates
    .map((d) => parseDate(d))
    .filter(Boolean)
    .sort((a, b) => (a as Date).getTime() - (b as Date).getTime());
  if (!parsed.length) return null;
  return (parsed[0] as Date).toISOString().slice(0, 10);
};
