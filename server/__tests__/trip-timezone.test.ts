/// <reference types="jest" />
import * as db from '../src/db';
import { clearTripTimezoneCacheForTesting, resolveTripTimezone, timezoneForCoordinates } from '../src/services/tripTimezoneService';

describe('trip destination time zone (offline lookup)', () => {
  beforeEach(() => {
    clearTripTimezoneCacheForTesting();
    jest.restoreAllMocks();
  });

  it('maps coordinates to IANA zones offline', () => {
    expect(timezoneForCoordinates(48.8566, 2.3522)).toBe('Europe/Paris');
    expect(timezoneForCoordinates(21.3069, -157.8583)).toBe('Pacific/Honolulu');
    expect(timezoneForCoordinates(-33.8688, 151.2093)).toBe('Australia/Sydney');
  });

  it('uses a stored zone without looking at flights', async () => {
    jest.spyOn(db, 'getTripTimezone').mockResolvedValue('Asia/Tokyo');
    const flights = jest.spyOn(db, 'listFlights');
    expect(await resolveTripTimezone('trip-1', 'user-1')).toBe('Asia/Tokyo');
    expect(flights).not.toHaveBeenCalled();
  });

  it('derives the zone from the earliest flight with a usable arrival airport, and stores it', async () => {
    jest.spyOn(db, 'getTripTimezone').mockResolvedValue(null);
    jest.spyOn(db, 'listFlights').mockResolvedValue([
      { departureDate: '2026-07-12', arrivalAirportCode: 'NRT' },
      { departureDate: '2026-07-10', arrivalAirportCode: 'XXX' }, // unknown airport
      { departureDate: '2026-07-11', arrivalAirportCode: 'NUL' }, // placeholder 0,0
      { departureDate: '2026-07-11', arrivalAirportCode: 'CDG' },
    ] as any);
    jest.spyOn(db, 'getAirportByIataCode').mockImplementation(async (code: string) => ({
      XXX: null,
      NUL: { iataCode: 'NUL', name: '', city: '', country: '', lat: 0, lng: 0 },
      CDG: { iataCode: 'CDG', name: 'Charles de Gaulle', city: 'Paris', country: 'FR', lat: 49.0097, lng: 2.5479 },
      NRT: { iataCode: 'NRT', name: 'Narita', city: 'Tokyo', country: 'JP', lat: 35.772, lng: 140.3929 },
    } as any)[code]);
    const store = jest.spyOn(db, 'setTripTimezone').mockResolvedValue(undefined);
    expect(await resolveTripTimezone('trip-2', 'user-1')).toBe('Europe/Paris');
    expect(store).toHaveBeenCalledWith('trip-2', 'Europe/Paris');
  });

  it('returns null when nothing usable is known', async () => {
    jest.spyOn(db, 'getTripTimezone').mockResolvedValue(null);
    jest.spyOn(db, 'listFlights').mockResolvedValue([]);
    expect(await resolveTripTimezone('trip-3', 'user-1')).toBeNull();
  });
});
