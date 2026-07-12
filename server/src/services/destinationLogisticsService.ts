import { haversineKm, type LatLon } from '../utils/geo';
import { calculateDaylightWindow, fetchMonthlyClimatology, type DaylightWindow, type MonthlyClimatology } from './climatologyDaylightService';

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

