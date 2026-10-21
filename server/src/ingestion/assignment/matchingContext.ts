import { logError } from '../../logger';
import { getAirportByIataCode, listTrips, listLodgings, listActivities, listCarRentals, listGroupMembers } from '../../db';
import type { GroupMember, ImportForwarderTrust, Trip } from '../../types';
import type { PersistedParsedItem } from '../contracts';
import { getDestinationLocationOptionsByIds } from '../../services/destinationAttractionAutocompleteService';
import { getLocationOptionsByIds, searchCountryStateOptions, searchCityOptions } from '../../services/locationServices';
import { getIngestedDocumentById, listTripBookingReferences } from '../shared/repository';
import { getMailReceipt } from '../shared/mailAdmission';
import { trustedForwarder } from '../shared/receiverAuthentication';
import { bookingDates, matchItemToTrip, mergedBookingFields, type MatchTrip } from './tripMatcher';

export async function forwardingTrust(item: PersistedParsedItem, userId: string): Promise<ImportForwarderTrust> {
  if (item.sourceType !== 'FORWARDED_MAILBOX') return 'not_forwarded';
  const doc = await getIngestedDocumentById(item.rawDocId);
  const receiptId = doc?.metadata?.receiverReceiptId;
  if (doc?.userId !== userId || doc.importJobId !== item.importJobId || doc.sourceType !== 'FORWARDED_MAILBOX' || doc.virusScanStatus !== 'PASSED' || typeof receiptId !== 'string') return 'uncertain';
  const receipt = await getMailReceipt(receiptId, userId);
  return receipt && receipt.expiresAt > Date.now() && receipt.state !== 'HELD' && await trustedForwarder(userId, receipt.authentication) ? 'verified' : 'uncertain';
}
export async function resolveTripPlaces(locationIds: unknown, legacyDestination?: string | null) {
  const ids = Array.isArray(locationIds) ? locationIds.map(String).filter(Boolean) : [];
  const [options, destinations] = await Promise.all([getLocationOptionsByIds(ids), getDestinationLocationOptionsByIds(ids)]);
  const cities = new Set<string>(), broad = new Set<string>();
  for (const option of options) (option.sourceType === 'city' ? cities : broad).add(option.name);
  for (const destination of destinations) {
    cities.add(destination.name); if (destination.nearestCity) cities.add(destination.nearestCity);
    if (destination.countryName) broad.add(destination.countryName);
  }
  const tokens = (legacyDestination ?? '').split(/[,;]/).map(t => t.trim()).filter(Boolean);
  const exactRegions = (await Promise.all(tokens.map(async token =>
    (await searchCountryStateOptions(token, 20)).find(option => option.name.toLocaleLowerCase() === token.toLocaleLowerCase())
  ))).filter((option): option is NonNullable<typeof option> => Boolean(option));
  const countryIds = exactRegions.filter(option => option.sourceType === 'country').map(option => option.id);
  for (const region of exactRegions) {
    // Tokyo and New York name both cities and states. A known city within an explicit country
    // can disambiguate legacy text; a country/state name alone remains weak evidence.
    const city = region.sourceType === 'state' && countryIds.length
      ? (await searchCityOptions(region.name, { countryIds, limit: 50 })).find(city => city.name.toLocaleLowerCase() === region.name.toLocaleLowerCase()) : null;
    if (city) cities.add(city.name); else broad.add(region.name);
  }
  return { cities: [...cities], broad: [...broad].filter(name => !cities.has(name)) };
}
const normalizeName = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
type MemberNames = Pick<GroupMember, 'firstName' | 'lastName' | 'guestName'>;
const travelerMatches = (names: string[], members: MemberNames[]) => members.filter(member => {
  const actual = normalizeName(member.guestName || [member.firstName, member.lastName].filter(Boolean).join(' '));
  return actual.length >= 2 && names.some(name => { const tokens = normalizeName(name); return actual.every(token => tokens.includes(token)); });
}).length;
const baseTrip = (trip: Trip): MatchTrip => ({ id: trip.id, name: trip.name, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, startMonth: trip.startMonth, startYear: trip.startYear });

/** One request-scoped authorized context, shared by manual suggestions and automatic matching. */
export async function buildMatchingContext(userId: string, items: readonly PersistedParsedItem[]) {
  const trips = await listTrips(userId);
  const base = trips.map(baseTrip);
  const eligible = new Set(items.flatMap(item => matchItemToTrip(item, base, { sourceTrusted: false, automaticAddingOn: false }).candidates.map(c => c.tripId)));
  // Never hydrate just the displayed top five: a sixth strong candidate still makes a match ambiguous.
  let complete = true;
  const read = async <T>(work: Promise<T>, fallback: T): Promise<T> => {
    try { return await work; } catch (error) { complete = false; logError('[ingestion][matching] evidence unavailable; leaving suggestions for individual review', error); return fallback; }
  };
  const refs = await read(listTripBookingReferences([...eligible]), new Map());
  const membersByGroup = new Map<string, Promise<MemberNames[]>>();
  const enriched = await Promise.all(trips.filter(t => eligible.has(t.id)).map(async trip => {
    const [places, lodgings, activities, rentals] = await Promise.all([
      read(resolveTripPlaces(trip.locationIds, trip.destination), { cities: [] as string[], broad: [] as string[] }),
      read(listLodgings(userId, trip.id), []), read(listActivities(userId, trip.id), []), read(listCarRentals(userId, trip.id), []),
    ]);
    if (!membersByGroup.has(trip.groupId)) membersByGroup.set(trip.groupId, read(listGroupMembers(trip.groupId, userId), []));
    const members = await membersByGroup.get(trip.groupId)!;
    const located = [...lodgings, ...activities, ...rentals];
    const cities = [...places.cities, ...located.filter(row => ['catalog','manual','airport'].includes(row.coordinateSource ?? '')).map(row => row.geoCity).filter((city): city is string => Boolean(city))];
    return { ...baseTrip(trip), destination: [trip.destination, ...new Set(cities)].filter(Boolean).join(', '), broadPlaces: places.broad,
      weakPlaces: located.map(row => row.geoCity).filter((city): city is string => Boolean(city) && !cities.includes(city!)),
      bookingReferences: refs.get(trip.id) ?? [], members };
  }));
  const airports = new Map<string, Promise<string | null>>();
  const cityFor = async (value: unknown) => {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const code = /^[A-Z]{3}$/.test(text) ? text : text.match(/\(([A-Z]{3})\)/)?.[1];
    if (!code) return null;
    if (!airports.has(code)) airports.set(code, read(getAirportByIataCode(code).then(a => a?.city || null), null));
    return airports.get(code)!;
  };
  const airportCities = async (item: PersistedParsedItem) => {
    const fields = mergedBookingFields(item);
    const [arrival, departure] = await Promise.all([
      Promise.all([fields.arrivalAirportCode, fields.arrivalLocation].map(cityFor)),
      Promise.all([fields.departureAirportCode, fields.departureLocation].map(cityFor)),
    ]);
    return { arrivalCities: arrival.filter((c): c is string => Boolean(c)), departureCities: departure.filter((c): c is string => Boolean(c)) };
  };
  return {
    trips,
    async evaluate(item: PersistedParsedItem, automaticAddingOn: boolean, trustOverride?: boolean) {
      const cities = await airportCities(item);
      const trust = await forwardingTrust(item, userId);
      const sourceTrusted = trustOverride ?? (item.sourceType === 'MANUAL_UPLOAD' || trust === 'verified');
      const decision = matchItemToTrip(item, enriched.map(trip => ({ ...trip, travelerMatches: travelerMatches(item.travelerNames ?? [], trip.members) })), { ...cities, automaticAddingOn, sourceTrusted, evidenceComplete: complete });
      return { ...decision, tripName: trips.find(t => t.id === decision.tripId)?.name ?? null, forwarderTrust: trust };
    },
    async draft(item: PersistedParsedItem): Promise<import('../../types').ImportTripDraft> {
      const fields = mergedBookingFields(item), dates = bookingDates(item), cities = await airportCities(item);
      const query = cities.arrivalCities[0] || [fields.arrivalCity, fields.geoCity, fields.geo_city, fields.pickupCity, fields.location, fields.arrivalLocation, fields.propertyName].find(v => typeof v === 'string' && v.trim()) || '';
      const destinationQuery = String(query).slice(0, 120).trim();
      return { name: destinationQuery ? `Trip to ${destinationQuery}` : 'Trip from imported booking', destinationQuery, startDate: dates.start ?? '', endDate: dates.end ?? '' };
    },
  };
}
