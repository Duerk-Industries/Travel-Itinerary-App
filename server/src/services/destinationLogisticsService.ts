import { haversineKm, type LatLon } from '../utils/geo';
import { calculateDaylightWindow, fetchMonthlyClimatology, type DaylightWindow, type MonthlyClimatology } from './climatologyDaylightService';
import { findBundledAirport } from './airportCatalog';

export type LogisticsMobility = 'L' | 'M' | 'H';
export type DestinationLogistics = {
  distanceFromHomeKm: number | null;
  estimatedFlightHours: number | null;
  isLongHaul: boolean;
  timezoneOffsetHours: number;
  timezoneOffsetSource: 'longitude-estimate';
  daylight: DaylightWindow;
  climatology: MonthlyClimatology | null;
};

export type CoarseHomeRegion = {
  airportCode?: string | null;
  region?: string | null;
  coordinates?: LatLon | null;
};

export type OpenJawLogisticsComparison = {
  homeAirport: string | null;
  entryAirport: string | null;
  exitAirport: string | null;
  roundTripDistanceKm: number | null;
  openJawDistanceKm: number | null;
  distanceSavingsKm: number | null;
  recommended: 'round_trip' | 'open_jaw' | 'insufficient_data';
  rationale: string;
};

/**
 * Resolve only a coarse, consented home anchor. Exact addresses never enter
 * this function, a cache key, or an LLM prompt; airport coordinates come from
 * the bundled public airport dataset.
 */
export const resolveCoarseHomeRegion = (home?: CoarseHomeRegion | null): { label: string | null; coordinates: LatLon | null } => {
  const explicit = home?.coordinates;
  if (explicit && Number.isFinite(Number(explicit.lat)) && Number.isFinite(Number(explicit.lon))) {
    return { label: home?.region?.trim() || home?.airportCode?.trim().toUpperCase() || null, coordinates: { lat: Number(explicit.lat), lon: Number(explicit.lon) } };
  }
  const airport = findBundledAirport(home?.airportCode);
  if (!airport || airport.lat == null || airport.lng == null) return { label: home?.region?.trim() || home?.airportCode?.trim().toUpperCase() || null, coordinates: null };
  return { label: airport.iata_code, coordinates: { lat: airport.lat, lon: airport.lng } };
};

/** Compare home-to-entry/exit legs for round-trip versus open-jaw routing. */
export const compareOpenJawLogistics = (params: {
  home?: CoarseHomeRegion | null;
  entry?: (LatLon & { label?: string | null }) | null;
  exit?: (LatLon & { label?: string | null }) | null;
  entryAirport?: string | null;
  exitAirport?: string | null;
  openJawThresholdKm?: number;
}): OpenJawLogisticsComparison => {
  const home = resolveCoarseHomeRegion(params.home);
  const entry = params.entry && Number.isFinite(Number(params.entry.lat)) && Number.isFinite(Number(params.entry.lon)) ? params.entry : null;
  const exit = params.exit && Number.isFinite(Number(params.exit.lat)) && Number.isFinite(Number(params.exit.lon)) ? params.exit : null;
  const entryLeg = home.coordinates && entry ? haversineKm(home.coordinates, entry) : null;
  const exitLeg = home.coordinates && exit ? haversineKm(home.coordinates, exit) : null;
  if (entryLeg == null || exitLeg == null) {
    return {
      homeAirport: home.label,
      entryAirport: params.entryAirport?.trim().toUpperCase() || null,
      exitAirport: params.exitAirport?.trim().toUpperCase() || null,
      roundTripDistanceKm: null,
      openJawDistanceKm: null,
      distanceSavingsKm: null,
      recommended: 'insufficient_data',
      rationale: 'Home and both trip-end coordinates are not available; preserve the traveler-selected routing and verify terminal access.'
    };
  }
  const sameHubDistance = entryLeg * 2;
  const openJawDistance = entryLeg + exitLeg;
  const savings = sameHubDistance - openJawDistance;
  const threshold = Math.max(0, Number(params.openJawThresholdKm ?? 250));
  const recommended = savings >= threshold ? 'open_jaw' : 'round_trip';
  return {
    homeAirport: home.label,
    entryAirport: params.entryAirport?.trim().toUpperCase() || null,
    exitAirport: params.exitAirport?.trim().toUpperCase() || null,
    roundTripDistanceKm: Math.round(sameHubDistance),
    openJawDistanceKm: Math.round(openJawDistance),
    distanceSavingsKm: Math.round(savings),
    recommended,
    rationale: recommended === 'open_jaw'
      ? `Open-jaw return is estimated to save about ${Math.round(savings)} km of home-terminal travel; compare fares, ground access, and schedule before booking.`
      : 'Round-trip routing remains preferable on coarse distance; compare total elapsed time, terminal access, and fare before changing hubs.',
  };
};

export const calculateTransferBuffer = (distanceKm: number, groupSize: number, mobility: LogisticsMobility): number => {
  const distance = Math.max(0, Number(distanceKm) || 0);
  const base = distance <= 1 ? 10 : distance <= 5 ? 15 : distance <= 25 ? 25 : 40;
  const group = Math.max(1, Math.round(Number(groupSize) || 1));
  const groupMinutes = Math.max(0, group - 2) * 3;
  const mobilityMinutes = mobility === 'L' ? 15 : mobility === 'M' ? 5 : 0;
  return Math.min(90, base + groupMinutes + mobilityMinutes);
};

export const estimateFlightHours = (distanceKm: number): number => Math.round((Math.max(0, distanceKm) / 800 + 2.5) * 10) / 10;
const longitudeOffset = (lon: number): number => Math.max(-12, Math.min(14, Math.round(lon / 15)));

export const buildDestinationLogistics = async (params: {
  destination: LatLon;
  home?: LatLon | null;
  year: number;
  month: number;
  fetchImpl?: typeof fetch;
}): Promise<DestinationLogistics> => {
  const distanceFromHomeKm = params.home ? Math.round(haversineKm(params.home, params.destination)) : null;
  const estimated = distanceFromHomeKm === null ? null : estimateFlightHours(distanceFromHomeKm);
  const timezoneOffsetHours = longitudeOffset(params.destination.lon);
  return {
    distanceFromHomeKm,
    estimatedFlightHours: estimated,
    isLongHaul: estimated !== null && estimated >= 7,
    timezoneOffsetHours,
    timezoneOffsetSource: 'longitude-estimate',
    daylight: calculateDaylightWindow({ ...params.destination, year: params.year, month: params.month, timezoneOffsetHours }),
    climatology: await fetchMonthlyClimatology({ ...params.destination, month: params.month, fetchImpl: params.fetchImpl }),
  };
};
