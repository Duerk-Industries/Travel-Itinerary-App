import type { PersistedParsedItem } from '../contracts';
import type { TripBookingEvidence } from '../../types';
import { INGESTION_CONFIDENCE_HIGH } from '../config';

export type MatchTrip = {
  id: string; name: string; destination?: string | null; broadPlaces?: readonly string[]; weakPlaces?: readonly string[];
  startDate?: string | Date | null; endDate?: string | Date | null;
  startMonth?: number | null; startYear?: number | null;
  /** Legacy unscoped references deliberately cannot establish continuity. */
  bookingReferences?: readonly (TripBookingEvidence | string)[];
  travelerMatches?: number;
};
export type MatchDecision = {
  decision: 'auto' | 'suggest' | 'review'; tripId: string | null; reasons: string[];
  candidates: Array<{ tripId: string; reasons: string[]; strong: boolean }>;
  heldBack?: 'automatic_adding_off' | 'untrusted_source' | 'review_required' | 'low_confidence' | 'duplicate' | 'timezone_uncertain' | 'not_unique' | 'weak_evidence' | 'no_trip';
};
export type MatchOptions = {
  sourceTrusted: boolean; automaticAddingOn: boolean; endedWithinDays?: number; now?: Date;
  /** Server-resolved airport cities, not text supplied as matcher instructions. */
  arrivalCities?: readonly string[]; departureCities?: readonly string[];
  /** Read failures must never turn incomplete evidence into a unique automatic match. */
  evidenceComplete?: boolean;
};
const DAY_MS = 86_400_000;
export const dateOnly = (value: unknown): string | null => {
  if (!value) return null;
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text ? text : null;
};
export const localDateIn = (iso: string | null | undefined, timeZone: string | null | undefined): string | null => {
  if (!iso) return null;
  const instant = new Date(iso); if (Number.isNaN(instant.getTime())) return null;
  if (timeZone) try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant); } catch { /* Suggest using the UTC date, never auto-add with this zone. */ }
  return instant.toISOString().slice(0, 10);
};
export const mergedBookingFields = (item: PersistedParsedItem): Record<string, unknown> => ({ ...item.extractedFields, ...item.editedFields });
export function bookingDates(item: PersistedParsedItem) {
  const fields = mergedBookingFields(item);
  const zone = typeof fields.originalTimezone === 'string' ? fields.originalTimezone : item.originalTimezone;
  const start = localDateIn(typeof fields.startDateTimeUtc === 'string' ? fields.startDateTimeUtc : item.startDateTimeUtc, zone);
  const end = localDateIn(typeof fields.endDateTimeUtc === 'string' ? fields.endDateTimeUtc : item.endDateTimeUtc, zone) ?? start;
  return { start, end, zone };
}
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const identity = (value: unknown) => normalize(value).replace(/ /g, '');
const hasPlace = (text: string, place: string) => normalize(place).length >= 3 && ` ${normalize(text)} `.includes(` ${normalize(place)} `);
const placeText = (fields: Record<string, unknown>, keys: string[]) => keys.map(key => fields[key]).filter((v): v is string => typeof v === 'string').join(' ');
const formatRange = (start: string, end: string) => {
  const fmt = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return start === end ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
};
export function tripDateWindow(trip: MatchTrip): { start: string; end: string; monthOnly: boolean } | null {
  const start = dateOnly(trip.startDate), end = dateOnly(trip.endDate);
  if (start && end && start <= end) return { start: addDays(start, -1), end: addDays(end, 1), monthOnly: false };
  if (trip.startDate || trip.endDate || !Number.isInteger(trip.startMonth) || !Number.isInteger(trip.startYear) || trip.startMonth! < 1 || trip.startMonth! > 12 || trip.startYear! < 1900 || trip.startYear! > 9999) return null;
  return { start: `${trip.startYear}-${String(trip.startMonth).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(trip.startYear!, trip.startMonth!, 0)).toISOString().slice(0, 10), monthOnly: true };
}

/** Pure, deterministic; traveler matches rank suggestions but never break automatic ambiguity. */
export function matchItemToTrip(item: PersistedParsedItem, trips: readonly MatchTrip[], options: MatchOptions): MatchDecision {
  const none = (): MatchDecision => ({ decision: 'review', tripId: null, reasons: [], candidates: [], heldBack: 'no_trip' });
  const { start, end, zone } = bookingDates(item);
  if (!start || !end || start > end) return none();
  const earliestEnd = addDays((options.now ?? new Date()).toISOString().slice(0, 10), -(options.endedWithinDays ?? 30));
  const fields = mergedBookingFields(item);
  const arrival = [placeText(fields, ['arrivalLocation', 'arrivalCity', 'address', 'location', 'startLocation', 'geoCity', 'geo_city', 'pickupCity', 'propertyName', 'pickupLocation']), ...(options.arrivalCities ?? [])].join(' ');
  const departure = [placeText(fields, ['departureLocation', 'departureCity']), ...(options.departureCities ?? [])].join(' ');
  const exactCities = [...(options.arrivalCities ?? []), ...['arrivalCity','geoCity','geo_city','pickupCity'].map(key => fields[key]).filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))];
  const reference = identity(fields.confirmationNumber ?? item.confirmationNumber);
  const provider = identity(fields.providerVendor ?? item.providerVendor);
  const candidates = trips.flatMap(trip => {
    const window = tripDateWindow(trip);
    if (!window || window.end < earliestEnd || start > window.end || end < window.start) return [];
    const tokens = (trip.destination ?? '').split(/[,;]/).map(t => t.trim()).filter(t => !(trip.broadPlaces ?? []).some(b => normalize(b) === normalize(t)));
    const arrivesThere = exactCities.length ? tokens.some(t => exactCities.some(city => normalize(city) === normalize(t))) : tokens.some(t => hasPlace(arrival, t));
    const departsThere = tokens.some(t => hasPlace(departure, t));
    const contained = start >= window.start && end <= window.end;
    const continuity = Boolean(provider && reference) && (trip.bookingReferences ?? []).some(existing => {
      if (typeof existing === 'string') return false;
      const oldStart = dateOnly(existing.startDate), oldEnd = dateOnly(existing.endDate) ?? oldStart;
      return identity(existing.provider) === provider && identity(existing.reference) === reference && existing.itemType === item.itemType
        && oldStart !== null && oldEnd !== null && oldStart <= oldEnd && oldStart >= window.start && oldEnd <= window.end;
    });
    const reasons: string[] = [window.monthOnly ? 'Booking dates overlap this trip’s planned month; exact trip dates still need confirmation'
      : contained ? `Booking dates ${formatRange(start, end)} fit this trip` : 'Booking dates overlap this trip'];
    if (arrivesThere) reasons.push('Booking location matches the destination');
    else if (departsThere) reasons.push('Departs from the destination');
    else if ((trip.broadPlaces ?? []).some(t => hasPlace(arrival, t))) reasons.push('Booking location is in the same country or region as this trip');
    if (!arrivesThere && (trip.weakPlaces ?? []).some(t => hasPlace(arrival, t))) reasons.push('An approximate location may fit; check it before choosing this trip');
    if (continuity) reasons.push('Same provider and booking number as something already in this trip');
    if (trip.travelerMatches) reasons.push('Traveler names match this trip’s group');
    return [{ tripId: trip.id, reasons, strong: !window.monthOnly && contained && (arrivesThere || continuity),
      evidence: Number(arrivesThere) + Number(continuity) + Number(departsThere), travelerMatches: trip.travelerMatches ?? 0 }];
  }).sort((a, b) => Number(b.strong) - Number(a.strong) || b.evidence - a.evidence || b.travelerMatches - a.travelerMatches || a.tripId.localeCompare(b.tripId));
  if (!candidates.length) return none();
  const strong = candidates.filter(c => c.strong), best = strong[0] ?? candidates[0]!;
  const base = { tripId: best.tripId, reasons: best.reasons, candidates: candidates.map(({ tripId, reasons, strong }) => ({ tripId, reasons, strong })) };
  const suggest = (heldBack: MatchDecision['heldBack']): MatchDecision => ({ ...base, decision: 'suggest', heldBack });
  if (strong.length > 1) return suggest('not_unique');
  if (!strong.length || options.evidenceComplete === false) return suggest('weak_evidence');
  if (!options.automaticAddingOn) return suggest('automatic_adding_off');
  if (!options.sourceTrusted) return suggest('untrusted_source');
  if (fields.automaticAssignmentAllowed === false || /cancel|update/i.test(String(fields.bookingStatus ?? fields.reservationStatus ?? ''))) return suggest('review_required');
  if (item.reviewStatus === 'DUPLICATE_FLAGGED' || item.duplicateDisposition) return suggest('duplicate');
  let validZone = false;
  try { if (zone) { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); validZone = true; } } catch { /* Ask rather than guess. */ }
  if (item.timezoneStatus !== 'RESOLVED' || !validZone) return suggest('timezone_uncertain');
  if (item.reviewStatus !== 'READY_FOR_REVIEW' || item.confidenceScore < INGESTION_CONFIDENCE_HIGH) return suggest('low_confidence');
  return { ...base, decision: 'auto' };
}
