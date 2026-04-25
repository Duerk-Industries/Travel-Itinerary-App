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
