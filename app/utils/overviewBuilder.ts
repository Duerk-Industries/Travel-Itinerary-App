type FlightLike = {
  id: string;
  departure_date?: string;
  departureDate?: string;
  departure_time?: string;
  departureTime?: string;
  arrival_time?: string;
  arrivalTime?: string;
  departure_airport_code?: string;
  arrival_airport_code?: string;
  departureAirportCode?: string;
  arrivalAirportCode?: string;
  carrier?: string;
  flight_number?: string;
  flightNumber?: string;
  booking_reference?: string;
  bookingReference?: string;
  layover_location?: string;
  layover_location_code?: string;
  layover_duration?: string;
  cost?: number;
};

type LodgingLike = {
  id: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms?: string;
  refundBy?: string;
  totalCost?: string;
  costPerNight?: string;
  address?: string;
};

type TourLike = {
  id: string;
  name: string;
  date: string;
  startTime?: string;
  startLocation?: string;
  duration?: string;
  cost?: string;
  freeCancelBy?: string;
  bookedOn?: string;
  reference?: string;
};

type CarRentalLike = {
  id: string;
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  vendor?: string;
  model?: string;
};

type ItineraryDetail = {
  id: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
};

export type OverviewRow = {
  dayLabel: string;
  dateLabel: string;
  type: 'activity' | 'flight' | 'lodging' | 'tour' | 'rental';
  label: string;
  time?: string | null;
  meta?: any;
};

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
};

const toMinutes = (value?: string | null): number | null => {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const compareByTimeThenLabel = (a: OverviewRow, b: OverviewRow) => {
  const aMinutes = toMinutes(a.time);
  const bMinutes = toMinutes(b.time);
  if (aMinutes != null && bMinutes != null && aMinutes !== bMinutes) return aMinutes - bMinutes;
  if (aMinutes != null && bMinutes == null) return -1;
  if (aMinutes == null && bMinutes != null) return 1;
  return a.label.localeCompare(b.label);
};

export const formatFlightSummary = (flight: FlightLike): string => {
  const carrier = flight.carrier || 'Carrier';
  const number = flight.flight_number || flight.flightNumber || '';
  const depCode = flight.departure_airport_code || flight.departureAirportCode || 'DEP';
  const arrCode = flight.arrival_airport_code || flight.arrivalAirportCode || 'ARR';
  const depTime = flight.departure_time || flight.departureTime || '??:??';
  const arrTime = flight.arrival_time || flight.arrivalTime || '??:??';
  const flightNum = number ? ` ${number}` : '';
  return `${carrier}${flightNum} from ${depCode} to ${arrCode} at ${depTime} - ${arrTime}`;
};

export const formatFlightDetails = (flight: FlightLike): Array<{ label: string; value: string }> => {
  const details: Array<{ label: string; value: string }> = [];
  details.push({ label: 'Carrier', value: flight.carrier || 'N/A' });
  details.push({ label: 'Flight Number', value: flight.flight_number || flight.flightNumber || 'N/A' });
  details.push({ label: 'Departure', value: flight.departure_airport_code || flight.departureAirportCode || 'N/A' });
  details.push({ label: 'Arrival', value: flight.arrival_airport_code || flight.arrivalAirportCode || 'N/A' });
  details.push({ label: 'Departure Time', value: flight.departure_time || flight.departureTime || 'N/A' });
  details.push({ label: 'Arrival Time', value: flight.arrival_time || flight.arrivalTime || 'N/A' });
  if (flight.layover_location || flight.layover_location_code) {
    details.push({
      label: 'Layover',
      value: flight.layover_location || flight.layover_location_code || 'N/A',
    });
  }
  if (flight.layover_duration) details.push({ label: 'Layover Duration', value: flight.layover_duration });
  if (flight.booking_reference || flight.bookingReference) {
    details.push({ label: 'Booking Reference', value: flight.booking_reference || flight.bookingReference || '' });
  }
  if (flight.cost != null) details.push({ label: 'Cost', value: `$${Number(flight.cost).toFixed(2)}` });
  return details;
};

export const formatLodgingSummary = (lodging: LodgingLike): string => {
  const checkIn = lodging.checkInDate || 'Check-in';
  return `${lodging.name} at ${checkIn}`;
};

export const formatLodgingDetails = (lodging: LodgingLike): Array<{ label: string; value: string }> => {
  return [
    { label: 'Name', value: lodging.name },
    { label: 'Check-in', value: lodging.checkInDate || 'N/A' },
    { label: 'Check-out', value: lodging.checkOutDate || 'N/A' },
    { label: 'Rooms', value: lodging.rooms || 'N/A' },
    { label: 'Refund By', value: lodging.refundBy || 'N/A' },
    { label: 'Address', value: lodging.address || 'N/A' },
    { label: 'Total Cost', value: lodging.totalCost ? `$${lodging.totalCost}` : 'N/A' },
    { label: 'Cost Per Night', value: lodging.costPerNight ? `$${lodging.costPerNight}` : 'N/A' },
  ];
};

export const formatTourSummary = (tour: TourLike): string => {
  const time = tour.startTime || 'Time TBD';
  const location = tour.startLocation || 'Location TBD';
  return `${tour.name} at ${time} at ${location}`;
};

export const formatTourDetails = (tour: TourLike): Array<{ label: string; value: string }> => {
  return [
    { label: 'Name', value: tour.name },
    { label: 'Date', value: tour.date || 'N/A' },
    { label: 'Start Time', value: tour.startTime || 'N/A' },
    { label: 'Start Location', value: tour.startLocation || 'N/A' },
    { label: 'Duration', value: tour.duration || 'N/A' },
    { label: 'Booking Reference', value: tour.reference || 'N/A' },
    { label: 'Booked On', value: tour.bookedOn || 'N/A' },
    { label: 'Free Cancel By', value: tour.freeCancelBy || 'N/A' },
    { label: 'Cost', value: tour.cost ? `$${tour.cost}` : 'N/A' },
  ];
};

export const formatRentalSummary = (rental: CarRentalLike, kind: 'pickup' | 'dropoff'): string => {
  const carType = rental.model || rental.vendor || 'Rental car';
  if (kind === 'pickup') {
    return `${carType} from ${rental.pickupLocation || 'Pickup location'} at ${rental.pickupDate || 'Pickup date'}`;
  }
  return `Return ${carType} to ${rental.dropoffLocation || 'Dropoff location'} at ${rental.dropoffDate || 'Dropoff date'}`;
};

export const buildOverviewRows = (params: {
  tripStartDate?: string | null;
  tripMonthLabel?: string | null;
  itineraryDetails: ItineraryDetail[];
  flights: FlightLike[];
  lodgings: LodgingLike[];
  tours: TourLike[];
  rentals?: CarRentalLike[];
}): OverviewRow[] => {
  const { tripStartDate, tripMonthLabel, itineraryDetails, flights, lodgings, tours, rentals = [] } = params;
  const startDate = parseDate(tripStartDate);

  const dayBuckets = new Map<string, { dayLabel: string; dateLabel: string; items: OverviewRow[] }>();
  const ensureBucket = (dayLabel: string, dateLabel: string) => {
    const key = `${dayLabel}-${dateLabel}`;
    if (!dayBuckets.has(key)) {
      dayBuckets.set(key, { dayLabel, dateLabel, items: [] });
    }
    return dayBuckets.get(key)!;
  };

  const getDayLabelForDate = (dateStr?: string) => {
    const date = parseDate(dateStr);
    if (!date || !startDate) return 'Day';
    const diff = Math.floor((date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? `Day ${diff}` : 'Day';
  };

  for (const detail of itineraryDetails) {
    const dateLabel = startDate
      ? new Date(startDate.getTime() + (detail.day - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : tripMonthLabel ?? `Day ${detail.day}`;
    const bucket = ensureBucket(`Day ${detail.day}`, dateLabel);
    bucket.items.push({
      dayLabel: bucket.dayLabel,
      dateLabel: bucket.dateLabel,
      type: 'activity',
      label: detail.activity,
      time: detail.time ?? null,
      meta: detail,
    });
  }

  for (const flight of flights) {
    const date = flight.departure_date || flight.departureDate;
    const bucket = ensureBucket(getDayLabelForDate(date), date || 'Date TBD');
    bucket.items.push({
      dayLabel: bucket.dayLabel,
      dateLabel: bucket.dateLabel,
      type: 'flight',
      label: formatFlightSummary(flight),
      time: flight.departure_time || flight.departureTime || null,
      meta: flight,
    });
  }

  for (const lodging of lodgings) {
    const date = lodging.checkInDate;
    const bucket = ensureBucket(getDayLabelForDate(date), date || 'Date TBD');
    bucket.items.push({
      dayLabel: bucket.dayLabel,
      dateLabel: bucket.dateLabel,
      type: 'lodging',
      label: formatLodgingSummary(lodging),
      time: null,
      meta: lodging,
    });
  }

  for (const tour of tours) {
    const date = tour.date;
    const bucket = ensureBucket(getDayLabelForDate(date), date || 'Date TBD');
    bucket.items.push({
      dayLabel: bucket.dayLabel,
      dateLabel: bucket.dateLabel,
      type: 'tour',
      label: formatTourSummary(tour),
      time: tour.startTime || null,
      meta: tour,
    });
  }

  for (const rental of rentals) {
    if (rental.pickupDate) {
      const bucket = ensureBucket(getDayLabelForDate(rental.pickupDate), rental.pickupDate || 'Date TBD');
      bucket.items.push({
        dayLabel: bucket.dayLabel,
        dateLabel: bucket.dateLabel,
        type: 'rental',
        label: formatRentalSummary(rental, 'pickup'),
        time: null,
        meta: rental,
      });
    }
    if (rental.dropoffDate) {
      const bucket = ensureBucket(getDayLabelForDate(rental.dropoffDate), rental.dropoffDate || 'Date TBD');
      bucket.items.push({
        dayLabel: bucket.dayLabel,
        dateLabel: bucket.dateLabel,
        type: 'rental',
        label: formatRentalSummary(rental, 'dropoff'),
        time: null,
        meta: rental,
      });
    }
  }

  const orderedBuckets = Array.from(dayBuckets.values()).sort((a, b) => {
    const dateA = parseDate(a.dateLabel);
    const dateB = parseDate(b.dateLabel);
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    return a.dateLabel.localeCompare(b.dateLabel);
  });

  const categoryOrder: OverviewRow['type'][] = ['activity', 'flight', 'lodging', 'tour', 'rental'];
  const rows: OverviewRow[] = [];
  for (const bucket of orderedBuckets) {
    const grouped: Record<string, OverviewRow[]> = {};
    bucket.items.forEach((item) => {
      const key = item.type;
      grouped[key] = grouped[key] ?? [];
      grouped[key].push(item);
    });
    for (const type of categoryOrder) {
      const items = grouped[type] ?? [];
      items.sort(compareByTimeThenLabel);
      rows.push(...items);
    }
  }

  return rows;
};
