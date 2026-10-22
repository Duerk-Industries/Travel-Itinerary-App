export type NotificationTiming = { timezone: string; quietStart: string; quietEnd: string };
export type DigestTiming = { timezone: string; time: string };

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

/** First chosen local time at/after a completed UTC digest window. In a DST
 * gap use the first real minute after the chosen wall time; in a repeated hour
 * use the first occurrence. The source digest window stays explicitly UTC. */
export const digestDueAt = (timing: DigestTiming, notBefore: number): number => {
  if (!validTimezone(timing.timezone)) return notBefore;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timing.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };
  const initial = local(notBefore);
  const targetDate = initial.time <= timing.time ? initial.date : new Date(Date.parse(`${initial.date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  for (let instant = Math.ceil(notBefore / 60_000) * 60_000; instant <= notBefore + 48 * 3600_000; instant += 60_000) {
    const value = local(instant);
    if (value.date > targetDate || (value.date === targetDate && value.time >= timing.time)) return instant;
  }
  return notBefore + 86400_000;
};
