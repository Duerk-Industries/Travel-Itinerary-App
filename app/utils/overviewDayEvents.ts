import { normalizeDateString } from './normalizeDateString';

type FlightForDay = {
  departure_date?: string | null;
  arrival_date?: string | null;
};

type LodgingForDay = {
  checkInDate?: string | null;
  checkOutDate?: string | null;
};

type TourForDay = {
  date?: string | null;
};

type RentalForDay = {
  pickupDate?: string | null;
  dropoffDate?: string | null;
};

type DetailForDay = {
  day?: number | string | null;
};

export const flightMatchesDay = (flight: FlightForDay, date: string): boolean =>
  flight.departure_date === date || flight.arrival_date === date;

export const tourMatchesDay = (tour: TourForDay, date: string): boolean =>
  tour.date === date;

export const rentalMatchesDay = (rental: RentalForDay, date: string): boolean =>
  rental.pickupDate === date || rental.dropoffDate === date;

export const detailMatchesDay = (detail: DetailForDay, dayNumber: number): boolean =>
  Number(detail.day) === dayNumber;

export const lodgingCoversDay = (lodging: LodgingForDay, date: string): boolean => {
  const ci = lodging.checkInDate;
  if (!ci) return false;
  const dayMs = normalizeDateString(date);
  const checkInMs = normalizeDateString(ci);
  if (!dayMs || !checkInMs) return false;
  const dayTime = new Date(dayMs).getTime();
  const checkInTime = new Date(checkInMs).getTime();
  if (Number.isNaN(dayTime) || Number.isNaN(checkInTime)) return false;
  const co = lodging.checkOutDate;
  if (!co) {
    return dayTime >= checkInTime;
  }
  const checkOutMs = normalizeDateString(co);
  if (!checkOutMs) {
    return dayTime >= checkInTime;
  }
  const checkOutTime = new Date(checkOutMs).getTime();
  if (Number.isNaN(checkOutTime)) {
    return dayTime >= checkInTime;
  }
  return dayTime >= checkInTime && dayTime < checkOutTime;
};

export type DayEvents<F, L, T, R, D> = {
  index: number;
  date: string;
  flights: F[];
  lodgings: L[];
  tours: T[];
  rentals: R[];
  details: D[];
};

export type BuildDayEventsParams<
  F extends FlightForDay,
  L extends LodgingForDay,
  T extends TourForDay,
  R extends RentalForDay,
  D extends DetailForDay,
> = {
  dayCards: ReadonlyArray<{ date: string }>;
  flights: ReadonlyArray<F>;
  lodgings: ReadonlyArray<L>;
  tours: ReadonlyArray<T>;
  rentals: ReadonlyArray<R>;
  details: ReadonlyArray<D>;
};

export const buildDayEventsMap = <
  F extends FlightForDay,
  L extends LodgingForDay,
  T extends TourForDay,
  R extends RentalForDay,
  D extends DetailForDay,
>(
  params: BuildDayEventsParams<F, L, T, R, D>,
): Map<string, DayEvents<F, L, T, R, D>> => {
  const map = new Map<string, DayEvents<F, L, T, R, D>>();
  params.dayCards.forEach((card, idx) => {
    const dayNumber = idx + 1;
    map.set(card.date, {
      index: dayNumber,
      date: card.date,
      flights: params.flights.filter((f) => flightMatchesDay(f, card.date)),
      lodgings: params.lodgings.filter((l) => lodgingCoversDay(l, card.date)),
      tours: params.tours.filter((t) => tourMatchesDay(t, card.date)),
      rentals: params.rentals.filter((r) => rentalMatchesDay(r, card.date)),
      details: params.details.filter((d) => detailMatchesDay(d, dayNumber)),
    });
  });
  return map;
};

type PlanFlight = FlightForDay & {
  departure_time?: string | null;
  arrival_time?: string | null;
  departure_location?: string | null;
  departure_airport_code?: string | null;
  arrival_location?: string | null;
  arrival_airport_code?: string | null;
};
type PlanTour = { name?: string | null; startTime?: string | null };
type PlanDetail = { kind?: string | null; time?: string | null; activity?: string | null };

const CLOCK = /^(\d{1,2}):(\d{2})/;
const minutesOf = (time: string | null | undefined): number | null => {
  const match = CLOCK.exec(String(time ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * When a transfer leaves, or null when that is not known. Template transfers whose time depends on the
 * traveler's flight are saved at 00:00 with no arrival time, so that pair means "not set", not midnight.
 */
export const transferDepartureTime = (flight: Pick<PlanFlight, 'departure_time' | 'arrival_time'>): string | null => {
  const departure = String(flight.departure_time ?? '').trim();
  if (!departure || (minutesOf(departure) === 0 && !String(flight.arrival_time ?? '').trim())) return null;
  return departure;
};

/**
 * One line per thing happening on a day, earliest first. A transfer that set off on an earlier day shows as
 * its arrival on this one; anything without a time follows the timed lines, transfers before stays and rentals.
 */
export const buildDayPlanLines = (
  date: string,
  info: { flights: PlanFlight[]; tours: PlanTour[]; details: PlanDetail[]; lodgings: Array<{ name?: string | null }>; rentals: Array<{ vendor?: string | null; pickupLocation?: string | null }> },
  formatTime: (time: string) => string = (time) => time,
): string[] => {
  const lines: Array<{ minutes: number | null; rank: number; text: string }> = [];
  const add = (time: string | null | undefined, rank: number, text: string) => {
    const minutes = minutesOf(time);
    lines.push({ minutes, rank, text: minutes === null ? text : `${formatTime(String(time).trim())} · ${text}` });
  };
  info.flights.forEach((flight) => {
    const route = `${flight.departure_location || flight.departure_airport_code || 'Departure'} → ${flight.arrival_location || flight.arrival_airport_code || 'Arrival'}`;
    if (flight.departure_date !== date && flight.arrival_date === date) {
      const arrival = String(flight.arrival_time ?? '').trim();
      add(arrival, 0, `Arrive: ${route}`);
    } else {
      add(transferDepartureTime(flight), 0, route);
    }
  });
  info.tours.forEach((tour) => add(tour.startTime, 1, String(tour.name ?? '')));
  info.details.filter((detail) => !detail.kind || detail.kind === 'activity').forEach((detail) => add(detail.time, 1, String(detail.activity ?? '')));
  info.lodgings.forEach((lodging) => lines.push({ minutes: null, rank: 2, text: `Stay: ${lodging.name}` }));
  info.rentals.forEach((rental) => lines.push({ minutes: null, rank: 3, text: `Rental car: ${rental.vendor || rental.pickupLocation}` }));
  return lines
    .map((line, index) => ({ ...line, index }))
    .sort((a, b) => {
      if ((a.minutes === null) !== (b.minutes === null)) return a.minutes === null ? 1 : -1;
      if (a.minutes !== null && b.minutes !== null && a.minutes !== b.minutes) return a.minutes - b.minutes;
      return a.rank - b.rank || a.index - b.index;
    })
    .map((line) => line.text)
    .filter(Boolean);
};
