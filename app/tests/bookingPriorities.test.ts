import { buildBookingPriorities } from '../utils/bookingPriorities';

describe('buildBookingPriorities', () => {
  const REFERENCE = new Date('2026-08-16T12:00:00Z');

  test('excludes items that are already Booked, Completed, or Cancelled', () => {
    const result = buildBookingPriorities(
      {
        flights: [
          { id: 'f1', status: 'Booked', departureDate: '2026-08-20' },
          { id: 'f2', status: 'Completed', departureDate: '2026-08-01' },
          { id: 'f3', status: 'Cancelled', departureDate: '2026-08-20' },
        ],
      },
      REFERENCE
    );
    expect(result).toEqual([]);
  });

  test('includes Needed and Proposed items, computing days-until from the reference date', () => {
    const result = buildBookingPriorities(
      {
        flights: [{ id: 'f1', status: 'Needed', departureDate: '2026-08-26', departureLocation: 'BOS', arrivalLocation: 'NRT' }],
        lodgings: [{ id: 'l1', status: 'Proposed', check_in_date: '2026-08-30', name: 'Hotel Gion' }],
      },
      REFERENCE
    );
    expect(result).toHaveLength(2);
    const flightItem = result.find((r) => r.id === 'f1');
    expect(flightItem).toMatchObject({ kind: 'flight', label: 'BOS → NRT', daysUntil: 10, urgency: 'soon' });
    const lodgingItem = result.find((r) => r.id === 'l1');
    expect(lodgingItem).toMatchObject({ kind: 'lodging', label: 'Hotel Gion', daysUntil: 14, urgency: 'soon' });
  });

  test('flags a past-dated unbooked item as overdue', () => {
    const result = buildBookingPriorities(
      { activities: [{ id: 'a1', status: 'Needed', date: '2026-08-10', name: 'Cooking class' }] },
      REFERENCE
    );
    expect(result[0]).toMatchObject({ urgency: 'overdue', daysUntil: -6 });
  });

  test('treats a missing/unparsable date as unscheduled and sorts it last', () => {
    const result = buildBookingPriorities(
      {
        carRentals: [{ id: 'c1', status: 'Needed', pickupDate: null, vendor: 'Toyota Rent a Car' }],
        activities: [{ id: 'a1', status: 'Needed', date: '2026-08-20', name: 'Fushimi Inari hike' }],
      },
      REFERENCE
    );
    expect(result.map((r) => r.id)).toEqual(['a1', 'c1']);
    expect(result[1]).toMatchObject({ urgency: 'unscheduled', daysUntil: null, date: null });
  });

  test('sorts overdue before soon before upcoming, ascending by days within each bucket', () => {
    const result = buildBookingPriorities(
      {
        flights: [{ id: 'far', status: 'Needed', departureDate: '2026-09-30' }],
        lodgings: [{ id: 'overdue', status: 'Needed', check_in_date: '2026-08-01' }],
        activities: [
          { id: 'soon-later', status: 'Needed', date: '2026-08-25' },
          { id: 'soon-sooner', status: 'Needed', date: '2026-08-18' },
        ],
      },
      REFERENCE
    );
    expect(result.map((r) => r.id)).toEqual(['overdue', 'soon-sooner', 'soon-later', 'far']);
  });

  test('is a pure function: empty/undefined inputs return an empty array without throwing', () => {
    expect(buildBookingPriorities({})).toEqual([]);
    expect(buildBookingPriorities({ flights: null, lodgings: undefined })).toEqual([]);
  });
});
