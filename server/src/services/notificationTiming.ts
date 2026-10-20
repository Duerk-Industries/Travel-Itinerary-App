export type NotificationTiming = { timezone: string; quietStart: string; quietEnd: string };

export const validTimezone = (value: string): boolean => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
};

/** Finds the next real instant outside the user's local quiet window. Iterating instants
 * handles nonexistent/repeated wall times at DST transitions without guessing an offset. */
export const quietUntil = (timing: NotificationTiming | null | undefined, now = Date.now()): number | null => {
  if (!timing || timing.quietStart === timing.quietEnd || !validTimezone(timing.timezone)) return null;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minutes(timing.quietStart), end = minutes(timing.quietEnd);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timing.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const quiet = (instant: number) => {
    const local = minutes(formatter.format(instant));
    return start < end ? local >= start && local < end : local >= start || local < end;
  };
  if (!quiet(now)) return null;
  for (let instant = Math.floor(now / 60_000) * 60_000 + 60_000; instant <= now + 48 * 3600_000; instant += 60_000) {
    if (!quiet(instant)) return instant;
  }
  return now + 3600_000;
};
