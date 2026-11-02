/// <reference types="jest" />
import { buildDayPlanLines, transferDepartureTime } from '../utils/overviewDayEvents';
import { formatClockTime } from '../utils/timeFormat';

// The Rio trip from the bug report: an overnight flight landing on day 2, and a template airport
// transfer whose time was left to depend on the flight (saved as 00:00 with no arrival time).
const flight = { departure_date: '2026-11-14', departure_time: '09:05', arrival_date: '2026-11-15', arrival_time: '06:10', departure_location: 'Boston (BOS)', arrival_location: 'Rio De Janeiro (GIG)' };
const airportTransfer = { departure_date: '2026-11-14', departure_time: '00:00', arrival_date: '2026-11-14', arrival_time: '', departure_location: 'Rio de Janeiro Airport (GIG)', arrival_location: 'Rio de Janeiro hotel area' };
const stay = { name: 'Hotel in Rio de Janeiro' };

describe('buildDayPlanLines', () => {
  it('lists the departure day in time order, with an unset transfer time after the timed lines', () => {
    expect(buildDayPlanLines('2026-11-14', { flights: [flight, airportTransfer], tours: [{ name: 'Arpoador sunset viewpoint', startTime: '16:30' }], details: [], lodgings: [stay], rentals: [] })).toEqual([
      '09:05 · Boston (BOS) → Rio De Janeiro (GIG)',
      '16:30 · Arpoador sunset viewpoint',
      'Rio de Janeiro Airport (GIG) → Rio de Janeiro hotel area',
      'Stay: Hotel in Rio de Janeiro',
    ]);
  });

  it('shows a flight that set off the day before as its arrival, and sorts the day by time', () => {
    const tours = [{ name: 'Christ the Redeemer', startTime: '08:00' }, { name: 'Samba night in Lapa', startTime: '20:30' }, { name: 'Santa Teresa and Parque das Ruínas', startTime: '14:00' }];
    expect(buildDayPlanLines('2026-11-15', { flights: [flight], tours, details: [], lodgings: [stay], rentals: [] })).toEqual([
      '06:10 · Arrive: Boston (BOS) → Rio De Janeiro (GIG)',
      '08:00 · Christ the Redeemer',
      '14:00 · Santa Teresa and Parque das Ruínas',
      '20:30 · Samba night in Lapa',
      'Stay: Hotel in Rio de Janeiro',
    ]);
  });

  it('mixes itinerary items in by time and shows times in the chosen format', () => {
    expect(buildDayPlanLines('2026-11-16', {
      flights: [], tours: [{ name: 'Sugarloaf', startTime: '9:30' }],
      details: [{ kind: 'activity', time: '07:15', activity: 'Breakfast' }, { kind: 'note', time: '06:00', activity: 'A note' }],
      lodgings: [], rentals: [{ vendor: 'Localiza' }],
    }, (time) => formatClockTime(time, '12h'))).toEqual(['7:15 AM · Breakfast', '9:30 AM · Sugarloaf', 'Rental car: Localiza']);
  });

  it('treats 00:00 as a real time when the transfer also has an arrival time', () => {
    expect(transferDepartureTime({ departure_time: '00:00', arrival_time: '' })).toBeNull();
    expect(transferDepartureTime({ departure_time: '00:00', arrival_time: '00:45' })).toBe('00:00');
    expect(transferDepartureTime({ departure_time: '', arrival_time: '' })).toBeNull();
  });
});
