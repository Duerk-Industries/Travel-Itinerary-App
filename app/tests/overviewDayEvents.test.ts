/// <reference types="jest" />
/// <reference types="node" />
import {
  buildDayEventsMap,
  detailMatchesDay,
  flightMatchesDay,
  lodgingCoversDay,
  rentalMatchesDay,
  tourMatchesDay,
} from '../utils/overviewDayEvents';

describe('overviewDayEvents', () => {
  describe('flightMatchesDay', () => {
    it('matches on departure_date', () => {
      expect(
        flightMatchesDay({ departure_date: '2025-04-10', arrival_date: '2025-04-11' }, '2025-04-10'),
      ).toBe(true);
    });

    it('matches on arrival_date', () => {
      expect(
        flightMatchesDay({ departure_date: '2025-04-10', arrival_date: '2025-04-11' }, '2025-04-11'),
      ).toBe(true);
    });

    it('does not match unrelated dates', () => {
      expect(
        flightMatchesDay({ departure_date: '2025-04-10', arrival_date: '2025-04-11' }, '2025-04-12'),
      ).toBe(false);
    });
  });

  describe('tourMatchesDay', () => {
    it('matches on date equality', () => {
      expect(tourMatchesDay({ date: '2025-04-10' }, '2025-04-10')).toBe(true);
      expect(tourMatchesDay({ date: '2025-04-11' }, '2025-04-10')).toBe(false);
    });
  });

  describe('rentalMatchesDay', () => {
    it('matches on pickup or dropoff', () => {
      expect(rentalMatchesDay({ pickupDate: '2025-04-10', dropoffDate: '2025-04-15' }, '2025-04-10')).toBe(true);
      expect(rentalMatchesDay({ pickupDate: '2025-04-10', dropoffDate: '2025-04-15' }, '2025-04-15')).toBe(true);
      expect(rentalMatchesDay({ pickupDate: '2025-04-10', dropoffDate: '2025-04-15' }, '2025-04-12')).toBe(false);
    });
  });

  describe('detailMatchesDay', () => {
    it('coerces day values before comparing', () => {
      expect(detailMatchesDay({ day: 2 }, 2)).toBe(true);
      expect(detailMatchesDay({ day: '2' }, 2)).toBe(true);
      expect(detailMatchesDay({ day: 3 }, 2)).toBe(false);
    });
  });

  describe('lodgingCoversDay', () => {
    it('covers days within the stay (excluding checkout)', () => {
      const l = { checkInDate: '2025-04-10', checkOutDate: '2025-04-13' };
      expect(lodgingCoversDay(l, '2025-04-09')).toBe(false);
      expect(lodgingCoversDay(l, '2025-04-10')).toBe(true);
      expect(lodgingCoversDay(l, '2025-04-12')).toBe(true);
      expect(lodgingCoversDay(l, '2025-04-13')).toBe(false);
    });

    it('covers all days from check-in forward when checkout is missing', () => {
      const l = { checkInDate: '2025-04-10', checkOutDate: null };
      expect(lodgingCoversDay(l, '2025-04-09')).toBe(false);
      expect(lodgingCoversDay(l, '2025-04-10')).toBe(true);
      expect(lodgingCoversDay(l, '2025-05-30')).toBe(true);
    });

    it('returns false when check-in is missing', () => {
      expect(lodgingCoversDay({ checkInDate: null, checkOutDate: '2025-04-12' }, '2025-04-10')).toBe(false);
    });
  });

  describe('buildDayEventsMap', () => {
    it('groups flights, lodgings, tours, rentals, and details by day', () => {
      const dayCards = [{ date: '2025-04-10' }, { date: '2025-04-11' }, { date: '2025-04-12' }];
      const flights = [
        { id: 'f1', departure_date: '2025-04-10', arrival_date: '2025-04-10' },
        { id: 'f2', departure_date: '2025-04-12', arrival_date: '2025-04-12' },
      ];
      const lodgings = [
        { id: 'l1', checkInDate: '2025-04-10', checkOutDate: '2025-04-12' },
      ];
      const tours = [{ id: 't1', date: '2025-04-11' }];
      const rentals = [{ id: 'r1', pickupDate: '2025-04-10', dropoffDate: '2025-04-12' }];
      const details = [
        { id: 'd1', day: 1 },
        { id: 'd2', day: 2 },
        { id: 'd3', day: 3 },
      ];

      const map = buildDayEventsMap({ dayCards, flights, lodgings, tours, rentals, details });

      expect(map.get('2025-04-10')).toMatchObject({
        index: 1,
        flights: [{ id: 'f1' }],
        lodgings: [{ id: 'l1' }],
        tours: [],
        rentals: [{ id: 'r1' }],
        details: [{ id: 'd1' }],
      });
      expect(map.get('2025-04-11')).toMatchObject({
        index: 2,
        flights: [],
        lodgings: [{ id: 'l1' }],
        tours: [{ id: 't1' }],
        rentals: [],
        details: [{ id: 'd2' }],
      });
      expect(map.get('2025-04-12')).toMatchObject({
        index: 3,
        flights: [{ id: 'f2' }],
        lodgings: [],
        tours: [],
        rentals: [{ id: 'r1' }],
        details: [{ id: 'd3' }],
      });
    });

    it('returns an empty map when there are no day cards', () => {
      const map = buildDayEventsMap({
        dayCards: [],
        flights: [],
        lodgings: [],
        tours: [],
        rentals: [],
        details: [],
      });
      expect(map.size).toBe(0);
    });
  });
});
