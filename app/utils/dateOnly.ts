/**
 * Date-only values represent a calendar day, not an instant in UTC. Parsing
 * `YYYY-MM-DD` with the JavaScript Date constructor treats it as UTC midnight,
 * which makes iOS show the preceding day west of UTC. Keep conversions for
 * native date pickers explicitly in the device's local calendar instead.
 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseLocalDateOnly = (value: string | null | undefined, fallback = new Date()): Date => {
  const match = String(value ?? '').match(DATE_ONLY_PATTERN);
  if (!match) return new Date(fallback.getTime());
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);
  // Date normalizes invalid values such as 2026-02-31, so verify that the
  // requested calendar day was preserved before accepting it.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return new Date(fallback.getTime());
  }
  return parsed;
};

export const formatLocalDateOnly = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const localTodayDateOnly = (): string => formatLocalDateOnly(new Date());
