/**
 * Date-only values represent a calendar day, not an instant in UTC. Parsing
 * `YYYY-MM-DD` with the Date constructor treats it as UTC midnight, which can
 * make native pickers display the preceding day west of UTC.
 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const parseLocalDateOnly = (value: string | null | undefined, fallback = new Date()): Date => {
  const match = String(value ?? '').match(DATE_ONLY_PATTERN);
  if (!match) return new Date(fallback.getTime());

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day);

  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== monthIndex
    || parsed.getDate() !== day
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
