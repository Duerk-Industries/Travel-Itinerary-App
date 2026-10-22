import { getTripById, listActivities, listCarRentals, listLodgings, setItemCoordinates } from '../db';
import { GeocoderError, geocodeAddress, getGeocoder, storedCoordinateCredit } from './geocoder';
import { logError } from '../logger';
import { countryCodeFromPlace } from '../utils/countryFromPlace';

export type LocateKind = 'lodging' | 'activity' | 'car_rental';

export type LocateResult =
  | { status: 'located'; lat: number; lng: number; geoCity: string | null; provider: string; attribution: string }
  | { status: 'already_located' }
  | { status: 'no_address' }
  | { status: 'not_found' }
  | { status: 'item_missing' }
  | { status: 'quota' }
  | { status: 'unavailable' };

const hasPoint = (lat: unknown, lng: unknown): boolean => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

/** A bare name ("Senso-ji") is ambiguous worldwide; the trip's destination narrows it. A full address already is not. */
const withDestination = (text: string, destination: string | null | undefined): string => {
  const place = (destination ?? '').trim();
  return place && !text.includes(',') ? `${text}, ${place}` : text;
};

/**
 * Where a place is, for a name-only search: the place names in its own address (prefecture, city, country) without
 * the street and block numbers, which are what open map data lacks. Falls back to the trip's destination. Keeping the
 * city matters: a name with only a country, or with a partial address, can match a same-named hotel elsewhere.
 */
const placeContext = (destination: string | null | undefined, address: string): string => {
  // A bare name ("Senso-ji") carries no locality of its own, so it cannot stand in for one.
  if (!address.includes(',')) return (destination ?? '').trim();
  const seen = new Set<string>();
  const names = address.split(',').map((part) => part.trim()).filter((part) => {
    const key = part.toLowerCase();
    if (!part || /\d/.test(part) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return names.length ? names.join(', ') : (destination ?? '').trim();
};

/**
 * Searches to try, best first. A saved address is the most direct, but some countries' addresses are not in open
 * map data to the building (Japanese block numbers, for example) while the place's name is. So a lodging or activity
 * whose address finds no confident match is searched again by name.
 */
export const searchesFor = (address: string, name: string, destination: string | null | undefined, byNameToo: boolean): string[] => {
  const searches = [withDestination(address, destination)];
  const named = name.trim();
  if (byNameToo && named && named.toLowerCase() !== address.trim().toLowerCase()) {
    const context = placeContext(destination, address);
    searches.push(context && !named.includes(',') ? `${named}, ${context}` : named);
  }
  return [...new Set(searches)];
};

/**
 * Finds coordinates for one lodging, activity or car rental from the address already saved on it, and stores them
 * with their source. An item that already has coordinates is left alone, so a hand-set location is never replaced.
 */
export const locateTripItem = async (params: {
  userId: string; tripId: string; kind: LocateKind; itemId: string; which?: 'pickup' | 'dropoff';
}): Promise<LocateResult> => {
  const { userId, tripId, kind, itemId } = params;
  const trip = await getTripById(tripId);

  let text = '';
  let name = '';
  let byNameToo = false;
  let already = false;
  let rental: { lat?: number | null; lng?: number | null; dropoffLat?: number | null; dropoffLng?: number | null } | null = null;
  const dropoff = params.which === 'dropoff';

  if (kind === 'lodging') {
    const item = (await listLodgings(userId, tripId)).find((entry) => entry.id === itemId);
    if (!item) return { status: 'item_missing' };
    text = (item.address || '').trim() || (item.name || '').trim();
    name = item.name || '';
    byNameToo = true;
    already = hasPoint(item.lat, item.lng);
  } else if (kind === 'activity') {
    const item = (await listActivities(userId, tripId)).find((entry) => entry.id === itemId);
    if (!item) return { status: 'item_missing' };
    text = (item.startLocation || '').trim() || (item.name || '').trim();
    name = item.name || '';
    byNameToo = true;
    already = hasPoint(item.lat, item.lng);
  } else {
    const item = (await listCarRentals(userId, tripId)).find((entry) => entry.id === itemId);
    if (!item) return { status: 'item_missing' };
    rental = item;
    text = ((dropoff ? item.dropoffLocation : item.pickupLocation) || '').trim();
    already = dropoff ? hasPoint(item.dropoffLat, item.dropoffLng) : hasPoint(item.lat, item.lng);
  }
  if (already) return { status: 'already_located' };
  if (!text) return { status: 'no_address' };

  const countryCode = countryCodeFromPlace(trip?.destination);
  let found;
  try {
    for (const search of searchesFor(text, name, trip?.destination, byNameToo)) {
      found = await geocodeAddress(search, { countryCode });
      if (found) break;
    }
  } catch (error) {
    const code = error instanceof GeocoderError ? error.code : 'provider';
    // Only the failure code is logged: never the address, and never anything that could carry the API key.
    logError(`[locate-item] geocoder failed code=${code}`);
    return { status: code === 'quota' || code === 'rate-limit' ? 'quota' : 'unavailable' };
  }
  if (!found) return { status: 'not_found' };

  // A rental stores both legs together, so write back the leg that was not located unchanged.
  await setItemCoordinates(userId, kind, itemId, kind === 'car_rental' && rental ? {
    lat: dropoff ? rental.lat ?? null : found.lat,
    lng: dropoff ? rental.lng ?? null : found.lng,
    dropoffLat: dropoff ? found.lat : rental.dropoffLat ?? null,
    dropoffLng: dropoff ? found.lng : rental.dropoffLng ?? null,
    coordinateSource: 'geocoder',
  } : { lat: found.lat, lng: found.lng, coordinateSource: 'geocoder' });

  const credit = storedCoordinateCredit();
  return { status: 'located', lat: found.lat, lng: found.lng, geoCity: found.geoCity, provider: getGeocoder()?.id ?? 'geocoder', attribution: credit?.text ?? '' };
};
