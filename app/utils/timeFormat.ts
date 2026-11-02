export type TimeFormat = '12h' | '24h';

export const isTimeFormat = (value: unknown): value is TimeFormat => value === '12h' || value === '24h';

/** For the Preferences buttons: 24-hour unless the traveler picked 12-hour. */
export const normalizeTimeFormat = (value: unknown, fallback: TimeFormat = '24h'): TimeFormat =>
  isTimeFormat(value) ? value : fallback;

export const timeFormatOptions: Array<{ key: TimeFormat; label: string }> = [
  { key: '24h', label: '24-hour (14:30)' },
  { key: '12h', label: '12-hour (2:30 PM)' },
];

// The signed-in traveler's choice, or null when they have not made one. App sets it from the profile
// while rendering, so every screen reads the same value without each one taking it as a prop.
let currentTimeFormat: TimeFormat | null = null;

export const setTimeFormatPreference = (format: TimeFormat | null): void => { currentTimeFormat = format; };
export const getTimeFormatPreference = (): TimeFormat | null => currentTimeFormat;

const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/g;

/**
 * A stored clock time ("14:30") as the traveler prefers to read it ("2:30 PM"). Every time in the text
 * is converted, so a range ("09:00-11:00") reads "9:00 AM-11:00 AM"; anything that is not a time is left as it is.
 */
export const formatClockTime = (value: string | null | undefined, format: TimeFormat | null = currentTimeFormat): string => {
  const text = String(value ?? '');
  // Stored times are 24-hour, so without a choice they show as stored.
  if (format !== '12h') return text;
  return text.replace(CLOCK, (_match, hours: string, minutes: string) => {
    const hour = Number(hours);
    return `${hour % 12 || 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
  });
};

/**
 * Options for `toLocaleTimeString`/`toLocaleString` that show the hour in the traveler's format. Without a choice
 * the device's own convention applies, as it always did for these times.
 */
export const clockOptions = (format: TimeFormat | null = currentTimeFormat): Intl.DateTimeFormatOptions => ({
  hour: 'numeric',
  minute: '2-digit',
  ...(format ? { hour12: format === '12h' } : {}),
});

/** The time of day of a moment, such as when a message was sent. */
export const formatTimeOfDay = (date: Date, format: TimeFormat | null = currentTimeFormat): string =>
  date.toLocaleTimeString(undefined, clockOptions(format));
