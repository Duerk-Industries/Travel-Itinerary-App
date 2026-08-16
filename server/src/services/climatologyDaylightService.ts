import { logError } from '../logger';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { getApiCacheSetting } from '../config/apiLimits';

export type MonthlyClimatology = {
  averageHighC: number | null;
  averageLowC: number | null;
  averageRainMmPerDay: number | null;
  label: string;
  source: 'open-meteo-historical';
};

export type DaylightWindow = { sunriseLocalHours: number; sunsetLocalHours: number; daylightHours: number };

const toRadians = (degrees: number): number => degrees * Math.PI / 180;
const toDegrees = (radians: number): number => radians * 180 / Math.PI;
const normalizeHours = (hours: number): number => ((hours % 24) + 24) % 24;

// NOAA-style solar approximation. Offset is explicit so callers cannot confuse solar/local clock time.
export const calculateDaylightWindow = (params: { lat: number; lon: number; year: number; month: number; timezoneOffsetHours: number }): DaylightWindow => {
  const date = new Date(Date.UTC(params.year, Math.max(0, Math.min(11, params.month - 1)), 15));
  const start = new Date(Date.UTC(params.year, 0, 0));
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const equationMinutes = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const latitude = toRadians(Math.max(-89.8, Math.min(89.8, params.lat)));
  const zenith = toRadians(90.833);
  const cosine = (Math.cos(zenith) / (Math.cos(latitude) * Math.cos(declination))) - Math.tan(latitude) * Math.tan(declination);
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  const solarNoonMinutes = 720 - 4 * params.lon - equationMinutes + params.timezoneOffsetHours * 60;
  const deltaMinutes = toDegrees(hourAngle) * 4;
  const sunriseLocalHours = normalizeHours((solarNoonMinutes - deltaMinutes) / 60);
  const sunsetLocalHours = normalizeHours((solarNoonMinutes + deltaMinutes) / 60);
  return { sunriseLocalHours, sunsetLocalHours, daylightHours: Math.max(0, Math.min(24, deltaMinutes * 2 / 60)) };
};

const average = (values: unknown[]): number | null => {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10 : null;
};

export const climatologyLabel = (highC: number | null, rainMm: number | null): string => {
  if (highC !== null && highC >= 25) return 'Peak Summer Heat';
  if (highC !== null && highC <= 5) return 'Cold Weather';
  if (rainMm !== null && rainMm >= 5) return 'Rainy Period';
  return 'Mild/Variable Weather';
};

const cache = new Map<string, { value: MonthlyClimatology | null; expiresAt: number }>();
export const fetchMonthlyClimatology = async (params: { lat: number; lon: number; month: number; fetchImpl?: typeof fetch; now?: Date }): Promise<MonthlyClimatology | null> => {
  const key = `${params.lat.toFixed(2)},${params.lon.toFixed(2)}:${params.month}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const now = params.now ?? new Date();
  const endYear = now.getUTCFullYear() - 1;
  const startYear = endYear - 9;
  const month = String(Math.max(1, Math.min(12, Math.round(params.month)))).padStart(2, '0');
  const lastDay = new Date(Date.UTC(endYear, Number(month), 0)).getUTCDate();
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${params.lat}&longitude=${params.lon}&start_date=${startYear}-${month}-01&end_date=${endYear}-${month}-${lastDay}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  try {
    await reserveApiUsageOrThrow({ provider: 'OPEN_METEO', caller: 'ITINERARY_MONTHLY_CLIMATOLOGY' });
    await recordProviderRequestCost({ provider: 'OPEN_METEO' });
    // archive-api.open-meteo.com (a decade-spanning daily aggregation query, unlike the plain
    // forecast/geocoding endpoints in openMeteoWeatherApi.ts) has been observed taking 60+
    // seconds to respond on some networks with no request-level timeout, which stalls the whole
    // itinerary generation job for a purely optional enrichment. Fail fast and let the existing
    // catch-and-cache-null-for-24h path degrade gracefully instead.
    const timeoutMs = getApiCacheSetting('weather', 'archiveTimeoutMs') ?? 8_000;
    const response = await (params.fetchImpl ?? fetch)(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const body: any = await response.json();
    const times: unknown[] = Array.isArray(body?.daily?.time) ? body.daily.time : [];
    const matchingIndexes = times
      .map((value, index) => ({ value: String(value ?? ''), index }))
      .filter(({ value }) => value.slice(5, 7) === month)
      .map(({ index }) => index);
    const selectMonth = (values: unknown[]): unknown[] => matchingIndexes.length
      ? matchingIndexes.map((index) => values[index])
      : values;
    const high = average(selectMonth(body?.daily?.temperature_2m_max ?? []));
    const low = average(selectMonth(body?.daily?.temperature_2m_min ?? []));
    const rain = average(selectMonth(body?.daily?.precipitation_sum ?? []));
    const value = { averageHighC: high, averageLowC: low, averageRainMmPerDay: rain, label: climatologyLabel(high, rain), source: 'open-meteo-historical' as const };
    cache.set(key, { value, expiresAt: Date.now() + 90 * 86400000 });
    return value;
  } catch (error) {
    logError('[itinerary] climatology lookup failed', error);
    cache.set(key, { value: null, expiresAt: Date.now() + 86400000 });
    return null;
  }
};

export const clearClimatologyCacheForTests = (): void => cache.clear();
