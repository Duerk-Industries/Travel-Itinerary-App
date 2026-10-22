import { getTripById, getLocationsByIds, listAttractionCatalogEntries, listTraitsForGroupTrip } from '../db';
import type { NearbyPlace, AttractionCatalogEntry } from '../types';
import { scoreActivityTypeByPreferences, type InterestWeights } from './activityTypeInterestWeights';
import { estimateAttractionDurationMinutes } from './attractionDurationEstimationService';
import { normalizeDestinationKey } from './attractionsCatalogService';
import { reusableCatalogPlace } from './planningOperations';

const MAX_DESTINATIONS = 12;
const TTL_MS = 5 * 60_000;
type CatalogIndex = { entries: AttractionCatalogEntry[]; cells: Map<string, AttractionCatalogEntry[]> };
const catalogs = new Map<string, { expires: number; promise: Promise<CatalogIndex> }>();
const cellKey = (lat: number, lng: number) => `${Math.floor(lat * 50)}:${Math.floor(lng * 50)}`;
export const invalidateNearbyCatalog = (): void => catalogs.clear();
const load = (userId: string, destination: string): Promise<CatalogIndex> => {
  const key = normalizeDestinationKey(destination);
  const current = catalogs.get(key);
  if (current && current.expires > Date.now()) return current.promise;
  if (catalogs.size >= MAX_DESTINATIONS) catalogs.delete(catalogs.keys().next().value!);
  // Reuse the existing catalog projection and its bounded rank window. No
  // provider, image enrichment, duration lookup or LLM call occurs on browse.
  const promise = listAttractionCatalogEntries(userId, key, 2000).then(rows => {
    const entries = rows.filter(reusableCatalogPlace); const cells = new Map<string, AttractionCatalogEntry[]>();
    for (const entry of entries) { const key = cellKey(entry.lat!, entry.lon!); const cell = cells.get(key) || []; cell.push(entry); cells.set(key, cell); }
    return { entries, cells };
  });
  catalogs.set(key, { expires: Date.now() + TTL_MS, promise });
  void promise.catch(() => { if (catalogs.get(key)?.promise === promise) catalogs.delete(key); });
  return promise;
};
export const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const r = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
};
export const findNearbyPlaces = async (userId: string, tripId: string, requestedCenter: { lat?: number; lng?: number; area?: string }, offset = 0): Promise<{ places: NearbyPlace[]; nextOffset: number | null }> => {
  const trip = await getTripById(tripId);
  if (!trip) return { places: [], nextOffset: null };
  const destination = trip.destination || (await getLocationsByIds(userId, (trip.locationIds || []).slice(0, 10))).find(place => place.sourceType === 'city')?.name;
  if (!destination) return { places: [], nextOffset: null };
  const [index, group] = await Promise.all([load(userId, destination), listTraitsForGroupTrip(tripId, userId)]);
  const entries = index.entries;
  const anchor = entries.find(place => requestedCenter.area && place.name.toLowerCase().includes(requestedCenter.area.toLowerCase())) ?? (!requestedCenter.area ? entries[0] : undefined);
  const center = !requestedCenter.area && typeof requestedCenter.lat === 'number' && typeof requestedCenter.lng === 'number'
    ? { lat: requestedCenter.lat, lng: requestedCenter.lng } : anchor ? { lat: anchor.lat!, lng: anchor.lon! } : null;
  if (!center) return { places: [], nextOffset: null };
  const weights: InterestWeights = { outdoors: 0, adventure: 0, culture: 0, food: 0, nightlife: 0, relax: 0, photography: 0, authentic_local: 0, iconic_landmarks: 0 };
  for (const traveler of group) for (const trait of traveler.traits) {
    for (const key of Object.keys(weights) as Array<keyof InterestWeights>) if (trait.toLowerCase().replace(/ /g, '_').includes(key)) weights[key] += 1;
  }
  const latDelta = 2000 / 111000;
  const lngDelta = Math.min(180, latDelta / Math.max(0.001, Math.cos(center.lat * Math.PI / 180)));
  let candidates = entries;
  // A bounded grid avoids a full destination scan for ordinary map areas.
  // At the poles/date line the 2,000-place hard bound is the safe fallback.
  if (lngDelta < 2 && center.lng - lngDelta >= -180 && center.lng + lngDelta <= 180) {
    candidates = [];
    for (let lat = Math.floor((center.lat - latDelta) * 50); lat <= Math.floor((center.lat + latDelta) * 50); lat++)
      for (let lng = Math.floor((center.lng - lngDelta) * 50); lng <= Math.floor((center.lng + lngDelta) * 50); lng++) candidates.push(...(index.cells.get(`${lat}:${lng}`) || []));
  }
  const ranked = candidates.filter(place => Math.abs(place.lat! - center.lat) <= latDelta
    && Math.min(Math.abs(place.lon! - center.lng), 360 - Math.abs(place.lon! - center.lng)) <= lngDelta)
    .map(place => ({ place, distance: haversineMeters(center, { lat: place.lat!, lng: place.lon! }) }))
    .filter(row => row.distance <= 2000)
    .map(row => ({ ...row, score: scoreActivityTypeByPreferences(row.place.activityType, weights) + Math.log1p(Math.max(0, row.place.popularityScore || 0)) - row.distance / 1000 }))
    .sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));
  const places = ranked.slice(offset, offset + 20).map(({ place, distance }): NearbyPlace => ({
    catalogId: place.id, name: place.name, lat: place.lat!, lng: place.lon!, distanceMeters: Math.round(distance),
    activityType: place.activityType, description: place.snippet || place.wikipediaSummary || '',
    durationMinutes: estimateAttractionDurationMinutes(place.name, place.activityType),
    sourceUrl: place.sourceUrl || null, sourceLabel: place.sourceLabel || 'Source',
  }));
  return { places, nextOffset: offset + 20 < ranked.length ? offset + 20 : null };
};
