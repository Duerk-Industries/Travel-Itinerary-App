// The one definition of an expense's "Description" text, shared by the Daily Expenses page, the
// cost report and the Paid/Incurred CSV exports so they never drift apart.
//
// Expenses mirrored from an itinerary item (flight, lodging, activity, car rental) are described by
// that item's name; any other expense uses its own Description field (stored as `vendor`), then its
// notes.

type Named = Record<string, any>;

export const flightExpenseDescription = (flight: Named): string => {
  const carrierAndNumber = [flight.carrier, flight.flight_number ?? flight.flightNumber].filter(Boolean).join(' ').trim();
  const departure = flight.departure_location || flight.departure_airport_code;
  const arrival = flight.arrival_location || flight.arrival_airport_code;
  const route = departure && arrival ? `${departure} → ${arrival}` : departure || arrival || '';
  return [carrierAndNumber, route].filter(Boolean).join(' · ');
};

export const carRentalExpenseDescription = (rental: Named): string => {
  const rentalName = [rental.vendor, rental.model].filter(Boolean).join(' · ').trim();
  const route = rental.pickupLocation && rental.dropoffLocation
    ? `${rental.pickupLocation} → ${rental.dropoffLocation}`
    : rental.pickupLocation || rental.dropoffLocation;
  return rentalName || route || '';
};

/** `{ 'flight:<id>': 'Carrier 123 · A → B', 'lodging:<id>': 'Hotel name', ... }` */
export const buildItineraryExpenseDescriptions = ({ flights = [], lodgings = [], tours = [], carRentals = [] }: {
  flights?: Named[]; lodgings?: Named[]; tours?: Named[]; carRentals?: Named[];
}): Record<string, string> => {
  const descriptions: Record<string, string> = {};
  const add = (sourceType: string, sourceId: unknown, description: unknown) => {
    const id = String(sourceId ?? '').trim();
    const name = String(description ?? '').trim();
    if (id && name) descriptions[`${sourceType}:${id}`] = name;
  };
  flights.forEach((flight) => add('flight', flight.id, flightExpenseDescription(flight)));
  lodgings.forEach((lodging) => add('lodging', lodging.id, lodging.name));
  tours.forEach((tour) => add('activity', tour.id, tour.name));
  carRentals.forEach((rental) => add('car_rental', rental.id, carRentalExpenseDescription(rental)));
  return descriptions;
};

/** Description for a stored expense row; '' when there is none. */
export const resolveExpenseDescription = (
  expense: { sourceType?: string | null; sourceId?: string | null; vendor?: string | null; notes?: string | null },
  itineraryDescriptions: Readonly<Record<string, string>> = {}
): string => {
  const sourceKey = expense.sourceType && expense.sourceId ? `${expense.sourceType}:${expense.sourceId}` : '';
  return itineraryDescriptions[sourceKey] || expense.vendor || expense.notes || '';
};
