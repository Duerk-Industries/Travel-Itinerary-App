import type { ParsedItemType } from '../contracts';
import { extractLabeledFieldValue, extractPhoneLikeValue, toTitleCaseWords } from './hotelFieldExtractors';

export type SemanticHelperType =
  | 'transport'
  | 'hotel'
  | 'car_rental'
  | 'activity'
  | 'generic';

const parseIsoLikeDate = (value: string): string | null => {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T12:00:00Z`).toISOString();
  const named = value.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i);
  if (!named) return null;
  const parsed = new Date(named[1]);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(`${parsed.toISOString().slice(0, 10)}T12:00:00Z`).toISOString();
};

const parseMoney = (value: string | null): number | null => {
  if (!value) return null;
  const matches = value.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const normalized = matches[matches.length - 1].replace(/,/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
};

const parseInteger = (value: string | null): number | null => {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
};

const parseCurrency = (value: string | null): string | null => {
  if (!value) return null;
  if (/US?\$/i.test(value) || /\$/.test(value)) return 'USD';
  if (/€/.test(value)) return 'EUR';
  if (/£/.test(value)) return 'GBP';
  return null;
};

const extractGuestName = (text: string): string | null => {
  const labeled = extractLabeledFieldValue(
    text,
    ['Guest name'],
    ['Check-in', 'Check-out', 'Max capacity', 'Breakfast', 'Prepayment', 'Payment', 'Room', 'Location', 'Address', 'Phone', 'Contact', 'Reservation details', 'Booking details'],
    true,
    180
  );
  if (labeled && /^[A-Z]/.test(labeled) && !/[<>@]/.test(labeled)) {
    return labeled.replace(/\s*\d[\s\S]*$/, '').trim() || null;
  }
  const fallback = text.match(/Thanks,\s*([A-Z][A-Za-z' -]{1,80})\s*!?\s+Your booking/i)?.[1];
  return fallback ? toTitleCaseWords(fallback) : null;
};

const extractHotelAddress = (text: string): string | null =>
  extractLabeledFieldValue(
    text,
    ['Location', 'Address'],
    ['Phone', 'Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out'],
    false,
    220
  )
  ?? text.match(/\b(?:Hotel|Resort|Inn|Suites|Lodge|Hostel|Motel|Villa|Boutique hotel)\s+([^.\n]{10,180}?)(?=\s+Phone\b)/i)?.[1]?.replace(/\s+/g, ' ').trim()
  ?? null;

const extractTransportFields = (text: string): Record<string, unknown> => {
  const departureLocation = extractLabeledFieldValue(text, ['From', 'Origin', 'Departure'], ['To', 'Destination', 'Arrival', 'Flight number', 'Confirmation', 'Booking']);
  const arrivalLocation = extractLabeledFieldValue(text, ['To', 'Destination', 'Arrival'], ['From', 'Origin', 'Departure', 'Flight number', 'Confirmation', 'Booking']);
  const departureDate = extractLabeledFieldValue(text, ['Departure', 'Depart', 'Date'], ['Arrival', 'Flight number', 'Confirmation', 'Booking'], false, 140);
  return {
    departureLocation: departureLocation ?? null,
    arrivalLocation: arrivalLocation ?? null,
    flightNumber: text.match(/\b([A-Z]{2}\s?\d{2,4})\b/)?.[1]?.replace(/\s+/g, '') ?? null,
    providerVendor: extractLabeledFieldValue(text, ['Airline', 'Carrier', 'Operator'], ['Flight number', 'Confirmation', 'Booking', 'Departure', 'Arrival']) ?? null,
    startDateTimeUtc: departureDate ? parseIsoLikeDate(departureDate) : null,
  };
};

const extractHotelFields = (text: string): Record<string, unknown> => {
  const checkIn = extractLabeledFieldValue(text, ['Check-in'], ['Check-out', 'Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details'], true, 140);
  const checkOut = extractLabeledFieldValue(text, ['Check-out'], ['Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details', 'Cancellation'], true, 140);
  const priceValue =
    extractLabeledFieldValue(text, ['You paid', 'Total Price', 'Trip total', 'Total price'], ['Guest name', 'Breakfast', 'Prepayment', 'Payment', 'Cancellation'], false, 80);
  const roomValue = text.match(/\b(\d+)\s+rooms?\b/i)?.[1]
    ?? extractLabeledFieldValue(text, ['Rooms'], ['Guest name', 'Check-in', 'Check-out', 'Breakfast', 'Location'], false, 40)
    ?? null;

  return {
    guestName: extractGuestName(text),
    address: extractHotelAddress(text),
    phone: extractPhoneLikeValue(
      extractLabeledFieldValue(text, ['Phone'], ['Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out'], false, 80) ?? text
    ),
    checkInDate: checkIn ? parseIsoLikeDate(checkIn) : null,
    checkOutDate: checkOut ? parseIsoLikeDate(checkOut) : null,
    freeCancelBy: parseIsoLikeDate(
      extractLabeledFieldValue(text, ['Free cancellation until', 'Cancel for free until'], ['Breakfast', 'Payment', 'Prepayment', 'Rooms'], true, 80)
      ?? text.match(/until\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s+[\d:]+\s*(?:AM|PM)?\s*:\s*(?:€|US?\$|\$)\s*0/i)?.[1]
      ?? text.match(/until\s+[\d:]+\s+on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s*(?:FREE|€\s*0|\$\s*0)/i)?.[1]
      ?? ''
    ),
    rooms: parseInteger(roomValue),
    breakfastIncluded: /\bbreakfast\s+(?:is\s+)?included\b/i.test(text)
      ? true
      : /\b(?:breakfast\s+not\s+included|no\s+breakfast)\b/i.test(text)
        ? false
        : null,
    totalCost: parseMoney(priceValue),
    currency: parseCurrency(priceValue),
    paid: /you paid/i.test(text)
      ? true
      : /\b(?:you'?ll pay when you stay|pay at the property|payment will be handled by)\b/i.test(text)
        ? false
        : null,
  };
};

const extractCarRentalFields = (text: string): Record<string, unknown> => ({
  pickupLocation: extractLabeledFieldValue(text, ['Pickup', 'Pick-up'], ['Dropoff', 'Drop-off', 'Vehicle', 'Car', 'Confirmation', 'Booking']) ?? null,
  dropoffLocation: extractLabeledFieldValue(text, ['Dropoff', 'Drop-off'], ['Pickup', 'Pick-up', 'Vehicle', 'Car', 'Confirmation', 'Booking']) ?? null,
  model: extractLabeledFieldValue(text, ['Vehicle', 'Car'], ['Pickup', 'Dropoff', 'Confirmation', 'Booking', 'Cost']) ?? null,
  cost: parseMoney(extractLabeledFieldValue(text, ['Cost', 'Total', 'You paid'], ['Pickup', 'Dropoff', 'Vehicle', 'Car', 'Confirmation', 'Booking'], true, 80)),
  startDateTimeUtc: parseIsoLikeDate(extractLabeledFieldValue(text, ['Pickup date', 'Pick-up date', 'Pickup'], ['Dropoff', 'Drop-off', 'Confirmation', 'Booking'], false, 120) ?? ''),
});

const extractActivityFields = (text: string): Record<string, unknown> => ({
  name: extractLabeledFieldValue(text, ['Event', 'Tour', 'Activity', 'Restaurant'], ['Location', 'Venue', 'Date', 'Time', 'Confirmation', 'Booking', 'Reference'], false, 140) ?? null,
  location: extractLabeledFieldValue(text, ['Location', 'Venue', 'Address'], ['Date', 'Time', 'Confirmation', 'Booking', 'Reference'], false, 140) ?? null,
  duration: extractLabeledFieldValue(text, ['Duration'], ['Location', 'Venue', 'Date', 'Time', 'Confirmation', 'Booking', 'Reference'], false, 80)
    ?? text.match(/\b(\d+\s*(?:hours?|hrs?|minutes?|mins?))\b/i)?.[1]
    ?? null,
  cost: parseMoney(extractLabeledFieldValue(text, ['Cost', 'Total', 'Price', 'You paid'], ['Location', 'Venue', 'Date', 'Time', 'Confirmation', 'Booking', 'Reference'], true, 80)),
  startDateTimeUtc: parseIsoLikeDate(extractLabeledFieldValue(text, ['Date', 'Starts', 'Start date'], ['Time', 'Location', 'Venue', 'Confirmation', 'Booking', 'Reference'], false, 120) ?? ''),
});

export const determineSemanticHelperType = (itemType: ParsedItemType): SemanticHelperType => {
  if (itemType === 'hotel') return 'hotel';
  if (itemType === 'flight' || itemType === 'rail' || itemType === 'ferry_bus_transfer') return 'transport';
  if (itemType === 'car_rental') return 'car_rental';
  if (itemType === 'tour_activity' || itemType === 'restaurant_reservation' || itemType === 'event_ticket') return 'activity';
  return 'generic';
};

export const extractSemanticFieldsForType = (itemType: ParsedItemType, text: string): Record<string, unknown> => {
  const helperType = determineSemanticHelperType(itemType);
  switch (helperType) {
    case 'hotel':
      return extractHotelFields(text);
    case 'transport':
      return extractTransportFields(text);
    case 'car_rental':
      return extractCarRentalFields(text);
    case 'activity':
      return extractActivityFields(text);
    default:
      return {};
  }
};
