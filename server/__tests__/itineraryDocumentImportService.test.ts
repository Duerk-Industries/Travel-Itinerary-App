import { isDuplicateItineraryCandidate, type ItineraryDocumentCandidate } from '../src/services/itineraryDocumentImportService';

const existing = (overrides: Partial<{ flights: any[]; lodgings: any[]; activities: any[]; carRentals: any[] }> = {}) => ({
  flights: [], lodgings: [], activities: [], carRentals: [], ...overrides,
});

describe('itinerary document import deduplication', () => {
  test('matches transfers within one day when either route endpoint overlaps', () => {
    const candidate: ItineraryDocumentCandidate = { type: 'flight', departureDate: '2026-09-11', departureLocation: 'JFK Airport', arrivalLocation: 'Paris CDG' };
    expect(isDuplicateItineraryCandidate(candidate, existing({ flights: [{ departureDate: '2026-09-10', departureAirportCode: 'JFK Airport', arrivalLocation: 'Paris CDG Airport' }] }))).toBe(true);
    expect(isDuplicateItineraryCandidate(candidate, existing({ flights: [{ departureDate: '2026-09-10', departureLocation: 'Boston Logan', arrivalLocation: 'London LHR' }] }))).toBe(false);
  });

  test('matches overlapping hotel stays by name or address', () => {
    const candidate: ItineraryDocumentCandidate = { type: 'hotel', name: 'The Grand Paris Hotel', address: '1 Rue Example', checkInDate: '2026-09-10', checkOutDate: '2026-09-14' };
    expect(isDuplicateItineraryCandidate(candidate, existing({ lodgings: [{ name: 'Grand Paris', address: 'Different address', checkInDate: '2026-09-12', checkOutDate: '2026-09-15' }] }))).toBe(true);
  });

  test('matches activities by date and normalized substring name', () => {
    expect(isDuplicateItineraryCandidate({ type: 'tour_activity', name: 'Louvre Museum Guided Tour', activityDate: '2026-09-12' }, existing({ activities: [{ name: 'Louvre Museum', date: '2026-09-12' }] }))).toBe(true);
  });

  test('matches rentals by pickup date and vendor or pickup location', () => {
    expect(isDuplicateItineraryCandidate({ type: 'car_rental', pickupDate: '2026-09-15', providerVendor: 'Hertz', pickupLocation: 'CDG' }, existing({ carRentals: [{ pickupDate: '2026-09-15', vendor: 'Hertz France', pickupLocation: 'ORY' }] }))).toBe(true);
  });
});
