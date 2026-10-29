/// <reference types="jest" />
import { normalizeFlightFromApi } from '../tabs/transfers';

// Postgres/in-memory adapters return DATE columns as midnight-UTC timestamps. Read as local time
// in a US time zone that's the previous evening, so a flight showed a day early and missed its
// itinerary day. Production (Firestore) stores plain YYYY-MM-DD, which must pass through unchanged.
describe('normalizeFlightFromApi dates', () => {
  it('turns midnight-UTC timestamps into the calendar date they represent', () => {
    const flight = normalizeFlightFromApi({ id: 'f1', departureDate: '2026-10-29T00:00:00.000Z', arrivalDate: '2026-10-30T00:00:00.000Z' });
    expect(flight.departure_date).toBe('2026-10-29');
    expect((flight as any).departureDate).toBe('2026-10-29');
    expect(flight.arrival_date).toBe('2026-10-30');
  });

  it('leaves plain dates and missing arrival dates alone', () => {
    const flight = normalizeFlightFromApi({ id: 'f2', departure_date: '2026-12-08', arrival_date: null });
    expect(flight.departure_date).toBe('2026-12-08');
    expect(flight.arrival_date).toBeNull();
  });
});
