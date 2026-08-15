/// <reference types="jest" />
/// <reference types="node" />
import * as db from '../src/db';
import { deriveReturnFlightDeadline, withReturnFlightDeadline } from '../src/routes/itineraryRoutes';

jest.mock('../src/db');

describe('deriveReturnFlightDeadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns undefined when the trip has no flights', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([]);
    expect(await deriveReturnFlightDeadline('user-1', 'trip-1')).toBeUndefined();
  });

  it('returns undefined (never throws) when the lookup fails', async () => {
    (db.listFlights as jest.Mock).mockRejectedValue(new Error('db down'));
    expect(await deriveReturnFlightDeadline('user-1', 'trip-1')).toBeUndefined();
  });

  it('picks the latest-departing flight as the return flight and derives a deadline hint', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([
      { transferType: 'Flight', departureDate: '2026-09-10', departureTime: '08:00' }, // outbound
      { transferType: 'Flight', departureDate: '2026-09-18', departureTime: '17:30' }, // return
    ]);
    expect(await deriveReturnFlightDeadline('user-1', 'trip-1')).toEqual({
      date: '2026-09-18',
      at: '17:30',
      reasonCode: 'RETURN_FLIGHT_DEPARTURE',
      requiredSlackMinutes: 120,
    });
  });

  it('ignores non-flight transfers and entries with malformed/missing date or time', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([
      { transferType: 'Train', departureDate: '2026-09-19', departureTime: '09:00' },
      { transferType: 'Flight', departureDate: '2026-09-18', departureTime: '' },
      { transferType: 'Flight', departureDate: 'not-a-date', departureTime: '10:00' },
      { transferType: 'Flight', departureDate: '2026-09-17', departureTime: '14:00' },
    ]);
    expect(await deriveReturnFlightDeadline('user-1', 'trip-1')).toEqual(
      expect.objectContaining({ date: '2026-09-17', at: '14:00' })
    );
  });
});

describe('withReturnFlightDeadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds the derived deadline when the caller supplied no hints at all', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([
      { transferType: 'Flight', departureDate: '2026-09-18', departureTime: '17:30' },
    ]);
    const result = await withReturnFlightDeadline('user-1', 'trip-1', undefined);
    expect(result?.deadlines).toEqual([
      { date: '2026-09-18', at: '17:30', reasonCode: 'RETURN_FLIGHT_DEPARTURE', requiredSlackMinutes: 120 },
    ]);
  });

  it('merges the derived deadline alongside existing caller-supplied hints', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([
      { transferType: 'Flight', departureDate: '2026-09-18', departureTime: '17:30' },
    ]);
    const result = await withReturnFlightDeadline('user-1', 'trip-1', {
      corridors: [{ fromLocationId: 'a', toLocationId: 'b', minutes: 60 }],
      deadlines: [{ date: '2026-09-15', at: '19:00', reasonCode: 'DINNER_RESERVATION' }],
    });
    expect(result?.corridors).toHaveLength(1);
    expect(result?.deadlines).toEqual(expect.arrayContaining([
      { date: '2026-09-15', at: '19:00', reasonCode: 'DINNER_RESERVATION' },
      { date: '2026-09-18', at: '17:30', reasonCode: 'RETURN_FLIGHT_DEPARTURE', requiredSlackMinutes: 120 },
    ]));
  });

  it('never overrides an explicit caller deadline already set for the same date', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([
      { transferType: 'Flight', departureDate: '2026-09-18', departureTime: '17:30' },
    ]);
    const explicit = { date: '2026-09-18', at: '15:00', reasonCode: 'MANUAL_OVERRIDE' };
    const result = await withReturnFlightDeadline('user-1', 'trip-1', { deadlines: [explicit] });
    expect(result?.deadlines).toEqual([explicit]);
  });

  it('passes hints through unchanged when there is no qualifying return flight', async () => {
    (db.listFlights as jest.Mock).mockResolvedValue([]);
    const hints = { corridors: [{ fromLocationId: 'a', toLocationId: 'b', minutes: 60 }] };
    const result = await withReturnFlightDeadline('user-1', 'trip-1', hints);
    expect(result).toBe(hints);
  });
});
