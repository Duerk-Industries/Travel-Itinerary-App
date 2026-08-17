// P2 (docs/implementation_plans/itinerary-narrative-depth-and-validation.md): a deterministic
// "what to book now" list, computed entirely client-side from data that's already been loaded
// and validated (flights, lodgings, activities, car rentals) — no LLM involved, so there's
// nothing here for a model to hallucinate. This is intentionally NOT persisted server-side;
// it's a derived view over trip items that are already the source of truth.

export type BookingPriorityKind = 'flight' | 'lodging' | 'activity' | 'carRental';
export type BookingPriorityUrgency = 'overdue' | 'soon' | 'upcoming' | 'unscheduled';

export type BookingPriorityItem = {
  id: string;
  kind: BookingPriorityKind;
  label: string;
  status: string;
  date: string | null;
  daysUntil: number | null;
  urgency: BookingPriorityUrgency;
};

type MinimalFlight = {
  id: string;
  status?: string | null;
  departureDate?: string | null;
  departureLocation?: string | null;
  arrivalLocation?: string | null;
  carrier?: string | null;
  flightNumber?: string | null;
};

type MinimalLodging = {
  id: string;
  status?: string | null;
  check_in_date?: string | null;
  name?: string | null;
};

type MinimalActivity = {
  id: string;
  status?: string | null;
  date?: string | null;
  name?: string | null;
};

type MinimalCarRental = {
  id: string;
  status?: string | null;
  pickupDate?: string | null;
  vendor?: string | null;
  model?: string | null;
};

const NEEDS_BOOKING_STATUSES = new Set(['Needed', 'Proposed']);
const SOON_THRESHOLD_DAYS = 14;

const parseDateOnly = (value: unknown): Date | null => {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return null;
  // A bare "YYYY-MM-DD" is parsed as UTC midnight by `new Date(str)`, which then shifts to the
  // previous local calendar day in any negative-UTC-offset timezone once we read it back with
  // local getters below — constructing from the parts directly keeps it anchored to the
  // intended calendar day regardless of the viewer's timezone.
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const daysBetween = (from: Date, to: Date): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / msPerDay);
};

const urgencyFor = (daysUntil: number | null): BookingPriorityUrgency => {
  if (daysUntil === null) return 'unscheduled';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= SOON_THRESHOLD_DAYS) return 'soon';
  return 'upcoming';
};

const buildItem = (
  id: string,
  kind: BookingPriorityKind,
  label: string,
  status: string,
  dateStr: string | null | undefined,
  referenceDate: Date
): BookingPriorityItem => {
  const parsed = parseDateOnly(dateStr);
  const daysUntil = parsed ? daysBetween(referenceDate, parsed) : null;
  return {
    id,
    kind,
    label,
    status,
    date: parsed ? dateStr!.trim() : null,
    daysUntil,
    urgency: urgencyFor(daysUntil),
  };
};

// Sort key: overdue first, then soon, then upcoming (each ascending by days-until), then
// unscheduled last (grouped, order not meaningful) — so the most time-critical bookings
// surface at the top regardless of which item type they are.
const URGENCY_RANK: Record<BookingPriorityUrgency, number> = {
  overdue: 0,
  soon: 1,
  upcoming: 2,
  unscheduled: 3,
};

const compareItems = (a: BookingPriorityItem, b: BookingPriorityItem): number => {
  const rankDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (rankDiff !== 0) return rankDiff;
  if (a.daysUntil !== null && b.daysUntil !== null) return a.daysUntil - b.daysUntil;
  return 0;
};

export const buildBookingPriorities = (
  input: {
    flights?: MinimalFlight[] | null;
    lodgings?: MinimalLodging[] | null;
    activities?: MinimalActivity[] | null;
    carRentals?: MinimalCarRental[] | null;
  },
  referenceDate: Date = new Date()
): BookingPriorityItem[] => {
  const items: BookingPriorityItem[] = [];

  for (const flight of input.flights ?? []) {
    if (!flight?.id || !NEEDS_BOOKING_STATUSES.has(String(flight.status))) continue;
    const route = [flight.departureLocation, flight.arrivalLocation].filter(Boolean).join(' → ');
    const label = route || flight.carrier || flight.flightNumber || 'Flight';
    items.push(buildItem(flight.id, 'flight', label, String(flight.status), flight.departureDate, referenceDate));
  }

  for (const lodging of input.lodgings ?? []) {
    if (!lodging?.id || !NEEDS_BOOKING_STATUSES.has(String(lodging.status))) continue;
    items.push(
      buildItem(lodging.id, 'lodging', lodging.name || 'Lodging', String(lodging.status), lodging.check_in_date, referenceDate)
    );
  }

  for (const activity of input.activities ?? []) {
    if (!activity?.id || !NEEDS_BOOKING_STATUSES.has(String(activity.status))) continue;
    items.push(
      buildItem(activity.id, 'activity', activity.name || 'Activity', String(activity.status), activity.date, referenceDate)
    );
  }

  for (const rental of input.carRentals ?? []) {
    if (!rental?.id || !NEEDS_BOOKING_STATUSES.has(String(rental.status))) continue;
    const label = [rental.vendor, rental.model].filter(Boolean).join(' ') || 'Car rental';
    items.push(buildItem(rental.id, 'carRental', label, String(rental.status), rental.pickupDate, referenceDate));
  }

  return items.sort(compareItems);
};
