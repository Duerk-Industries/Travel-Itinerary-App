import type { PersistedParsedItem } from '../contracts';
import { INGESTION_CONFIDENCE_HIGH } from '../config';

// Pure and deterministic: no network, no database, no model. It only reads the extracted booking facts
// and the candidate trips it is given, and it never accepts a trip id, score or instruction that came
// from a model or from the email itself. Anything it is unsure about becomes a suggestion for the
// person to confirm, never an automatic write.

export type MatchTrip = {
  id: string;
  name: string;
  /** City-level places the trip is going to, comma-separated. Strong evidence when a booking arrives there. */
  destination?: string | null;
  /** Country/state-level places. Too broad to add anything automatically; only used to explain a suggestion. */
  broadPlaces?: readonly string[];
  /** YYYY-MM-DD (a Date from the database driver is accepted and reduced to its calendar day). */
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  /** Normalized booking references already attached to this trip (flights, rentals, activities, earlier imports). */
  bookingReferences?: readonly string[];
};

export type MatchDecision = {
  decision: 'auto' | 'suggest' | 'review';
  tripId: string | null;
  /** Plain-language reasons for the chosen trip, safe to show to a non-technical user. */
  reasons: string[];
  /** Every trip that fits at least on dates, best first. */
  candidates: Array<{ tripId: string; reasons: string[]; strong: boolean }>;
  /** Why this did not qualify for automatic adding, when it did not. Never shown as a score. */
  heldBack?: 'automatic_adding_off' | 'untrusted_source' | 'review_required' | 'low_confidence' | 'duplicate' | 'timezone_uncertain' | 'not_unique' | 'weak_evidence' | 'no_trip';
};

export type MatchOptions = {
  /** True only for sources the signed-in owner acted on directly (their own upload). Forwarded mail is false. */
  sourceTrusted: boolean;
  /** The user's choice (or the release default) for automatic adding. */
  automaticAddingOn: boolean;
  /** Trips that ended more than this many days ago are not candidates. */
  endedWithinDays?: number;
  /** Injected for tests. */
  now?: Date;
};

const DAY_MS = 86_400_000;
const SLACK_DAYS = 1;

/** Calendar day of a value that may be a string or a Date, whichever the database driver returned. */
export const dateOnly = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const normalizeReference = (value: unknown): string => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone; falls back to the UTC date. */
export const localDateIn = (iso: string | null | undefined, timeZone: string | null | undefined): string | null => {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
    } catch {
      // Unknown zone name: use the UTC date below rather than guessing.
    }
  }
  return instant.toISOString().slice(0, 10);
};

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

const placeText = (fields: Record<string, unknown>, keys: string[]): string =>
  keys.map((key) => fields[key]).filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();

const destinationTokens = (destination?: string | null): string[] =>
  (destination ?? '').toLowerCase().split(/[,;]/).map((token) => token.trim()).filter((token) => token.length >= 3);

const formatRange = (start: string, end: string): string => {
  const fmt = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return start === end ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
};

const mergeFields = (item: PersistedParsedItem): Record<string, unknown> => ({ ...(item.extractedFields ?? {}), ...(item.editedFields ?? {}) });

export const matchItemToTrip = (item: PersistedParsedItem, trips: readonly MatchTrip[], options: MatchOptions): MatchDecision => {
  const none = (heldBack: MatchDecision['heldBack']): MatchDecision => ({ decision: 'review', tripId: null, reasons: [], candidates: [], heldBack });
  const startLocal = localDateIn(item.startDateTimeUtc, item.originalTimezone);
  const endLocal = localDateIn(item.endDateTimeUtc, item.originalTimezone) ?? startLocal;
  if (!startLocal || !endLocal) return none('no_trip');

  const now = options.now ?? new Date();
  const earliestEnd = new Date(now.getTime() - (options.endedWithinDays ?? 30) * DAY_MS).toISOString().slice(0, 10);
  const fields = mergeFields(item);
  // Where the booking takes you. Departure/origin is deliberately weaker evidence (a return leg departs from the destination).
  const arrivalSide = placeText(fields, ['arrivalLocation', 'arrivalCity', 'arrivalAirportCode', 'address', 'location', 'startLocation', 'propertyName', 'pickupLocation']);
  const departureSide = placeText(fields, ['departureLocation', 'departureCity', 'departureAirportCode']);
  const reference = normalizeReference(item.confirmationNumber ?? fields.confirmationNumber);

  const candidates = trips
    .map((trip) => ({ trip, tripStart: dateOnly(trip.startDate), tripEnd: dateOnly(trip.endDate) }))
    .filter(({ tripStart, tripEnd }) => tripStart && tripEnd && tripEnd >= earliestEnd)
    .map(({ trip, tripStart: start, tripEnd: end }) => {
      const tripStart = start!;
      const tripEnd = end!;
      const windowStart = addDays(tripStart, -SLACK_DAYS);
      const windowEnd = addDays(tripEnd, SLACK_DAYS);
      const overlaps = startLocal <= windowEnd && endLocal >= windowStart;
      const contained = startLocal >= windowStart && endLocal <= windowEnd;
      const tokens = destinationTokens(trip.destination);
      const inRegion = !tokens.some((token) => arrivalSide.includes(token)) && (trip.broadPlaces ?? []).some((place) => place.length >= 3 && arrivalSide.includes(place.toLowerCase()));
      const arrivesThere = tokens.some((token) => arrivalSide.includes(token));
      const departsThere = tokens.some((token) => departureSide.includes(token));
      const continuity = Boolean(reference) && (trip.bookingReferences ?? []).some((existing) => normalizeReference(existing) === reference);
      const reasons: string[] = [];
      if (contained) reasons.push(`Booking dates ${formatRange(startLocal, endLocal)} fit this trip`);
      else if (overlaps) reasons.push('Booking dates overlap this trip');
      if (arrivesThere) reasons.push('Booking location matches the destination');
      else if (departsThere) reasons.push('Departs from the destination');
      else if (inRegion) reasons.push('Booking location is in the same country or region as this trip');
      if (continuity) reasons.push('Same booking number as something already in this trip');
      // Strong = fully inside the window AND the booking goes to the destination, or is part of a booking already in the trip.
      const strong = contained && (arrivesThere || continuity);
      return { tripId: trip.id, overlaps, contained, strong, reasons, evidence: Number(arrivesThere) + Number(continuity) + Number(departsThere) };
    })
    .filter((candidate) => candidate.overlaps)
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.evidence - a.evidence || a.tripId.localeCompare(b.tripId));

  const summary = candidates.slice(0, 5).map(({ tripId, reasons, strong }) => ({ tripId, reasons, strong }));
  if (!candidates.length) return { ...none('no_trip'), candidates: [] };

  const strongOnes = candidates.filter((candidate) => candidate.strong);
  const best = strongOnes[0] ?? candidates[0]!;
  const base = { tripId: best.tripId, reasons: best.reasons, candidates: summary };

  // Automatic adding requires every gate. The first one that fails is reported so the screen can say why.
  if (strongOnes.length > 1) return { ...base, decision: 'suggest', heldBack: 'not_unique' };
  if (strongOnes.length === 0) return { ...base, decision: 'suggest', heldBack: 'weak_evidence' };
  if (!options.automaticAddingOn) return { ...base, decision: 'suggest', heldBack: 'automatic_adding_off' };
  if (!options.sourceTrusted) return { ...base, decision: 'suggest', heldBack: 'untrusted_source' };
  // Some extractors (calendar files, structured email data) record that their output must always be reviewed.
  if (fields.automaticAssignmentAllowed === false) return { ...base, decision: 'suggest', heldBack: 'review_required' };
  if (item.reviewStatus === 'DUPLICATE_FLAGGED' || item.duplicateDisposition) return { ...base, decision: 'suggest', heldBack: 'duplicate' };
  if (item.timezoneStatus !== 'RESOLVED') return { ...base, decision: 'suggest', heldBack: 'timezone_uncertain' };
  if (item.reviewStatus !== 'READY_FOR_REVIEW' || item.confidenceScore < INGESTION_CONFIDENCE_HIGH) return { ...base, decision: 'suggest', heldBack: 'low_confidence' };
  return { ...base, decision: 'auto' };
};
