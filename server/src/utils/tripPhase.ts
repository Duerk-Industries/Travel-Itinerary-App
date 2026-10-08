import { createHash } from 'node:crypto';
import type { AnalyticsTripPhase } from '../analytics/registry';

/**
 * Classifies when an event happened relative to a trip's scheduled dates
 * (docs/implementation-plans/analytics-upgrade.md Phase 2, decision 5).
 *
 * - Dates are the trip's inclusive start/end calendar dates (YYYY-MM-DD), compared
 *   with the event's calendar date *in the trip's local time*, never server time.
 * - Timezone fallback: segment → trip → the device timezone reported on the event →
 *   unknown. The level used is returned so reports can show fallback coverage
 *   (a device timezone is an unverified proxy).
 * - `dateVersion` fingerprints the dates and zone used, so a later edit to the
 *   trip's dates never silently rewrites an already-classified event.
 * This measures use during scheduled travel dates, not physical presence.
 */

export type TimezoneSource = 'segment' | 'trip' | 'device' | 'none';

export type TripPhaseInput = {
  occurredAt: string;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  segmentTimezone?: string | null;
  tripTimezone?: string | null;
  deviceTimezone?: string | null;
};

export type TripPhaseResult = {
  phase: AnalyticsTripPhase;
  timezoneSource: TimezoneSource;
  /** The event's calendar date in the zone used, when one was usable. */
  localDate: string | null;
  dateVersion: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Postgres DATE columns arrive as JS Dates (node-postgres builds local midnight; pg-mem
 * builds UTC midnight) even though Trip types them as strings. Read whichever clock shows
 * exactly midnight so neither source shifts the calendar day.
 */
const dateOnly = (value: unknown): string | null => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    return utcMidnight
      ? `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
      : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return typeof value === 'string' ? value : null;
};

const validDate = (input: unknown): string | null => {
  const value = dateOnly(input);
  if (!value) return null;
  const day = value.trim().slice(0, 10);
  if (!DATE_RE.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? null : day;
};

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

const formatterFor = (zone: string): Intl.DateTimeFormat | null => {
  if (formatterCache.has(zone)) return formatterCache.get(zone) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    formatter = null; // invalid IANA zone
  }
  if (formatterCache.size > 500) formatterCache.clear();
  formatterCache.set(zone, formatter);
  return formatter;
};

/** Calendar date (YYYY-MM-DD) of `instant` in `zone`, or null for an invalid zone or instant. */
export const localDateIn = (instant: string, zone: string): string | null => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = formatterFor(zone);
  if (!formatter) return null;
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null;
};

export const classifyTripPhase = (input: TripPhaseInput): TripPhaseResult => {
  const start = validDate(input.startDate);
  const end = validDate(input.endDate) ?? start;
  const unknown: TripPhaseResult = { phase: 'unknown', timezoneSource: 'none', localDate: null, dateVersion: null };
  if (!start || !end || end < start) return unknown;

  const candidates: Array<[TimezoneSource, string | null | undefined]> = [
    ['segment', input.segmentTimezone],
    ['trip', input.tripTimezone],
    ['device', input.deviceTimezone],
  ];
  for (const [source, zone] of candidates) {
    if (!zone) continue;
    const localDate = localDateIn(input.occurredAt, zone.trim());
    if (!localDate) continue;
    const phase: AnalyticsTripPhase = localDate < start ? 'pre_trip' : localDate > end ? 'post_trip' : 'during_trip';
    const dateVersion = createHash('sha256').update(`${start}|${end}|${source}:${zone.trim()}`).digest('hex').slice(0, 12);
    return { phase, timezoneSource: source, localDate, dateVersion };
  }
  return unknown;
};
