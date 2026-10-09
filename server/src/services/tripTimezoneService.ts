import tzlookup from '@photostructure/tz-lookup';
import { getAirportByIataCode, getTripTimezone, listFlights, setTripTimezone } from '../db';

/**
 * Trip destination time zone (analytics decision 5, Phase 7). Resolved offline — no API
 * call or cost — from the coordinates of the arrival airport of the trip's earliest
 * transfer, then stored on the trip so it is computed once. Returns null when nothing
 * usable is known; trip-phase classification then falls back to the device zone.
 *
 * Lodging coordinates are not used: lodging_locations currently holds placeholder
 * values (0,0 / "UTC") until a real Places integration fills them.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; zone: string | null }>();

const isUsableCoordinate = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** IANA zone for a coordinate, or null when it cannot be determined. */
export const timezoneForCoordinates = (lat: number, lng: number): string | null => {
  try {
    return tzlookup(lat, lng) || null;
  } catch {
    return null;
  }
};

export const resolveTripTimezone = async (tripId: string, userId: string): Promise<string | null> => {
  const cached = cache.get(tripId);
  if (cached && cached.expiresAt > Date.now()) return cached.zone;
  let zone = await getTripTimezone(tripId).catch(() => null);
  if (!zone) {
    const flights = await listFlights(userId, tripId).catch(() => []);
    const ordered = [...flights].sort((a, b) => String(a.departureDate ?? '').localeCompare(String(b.departureDate ?? '')));
    for (const flight of ordered) {
      const code = (flight as { arrivalAirportCode?: string }).arrivalAirportCode;
      if (!code) continue;
      const airport = await getAirportByIataCode(code).catch(() => null);
      if (!airport || !isUsableCoordinate(airport.lat, airport.lng)) continue;
      zone = timezoneForCoordinates(airport.lat as number, airport.lng as number);
      if (zone) {
        await setTripTimezone(tripId, zone).catch(() => undefined);
        break;
      }
    }
  }
  if (cache.size > 5_000) cache.clear();
  cache.set(tripId, { expiresAt: Date.now() + CACHE_TTL_MS, zone: zone ?? null });
  return zone ?? null;
};

export const clearTripTimezoneCacheForTesting = (): void => cache.clear();
