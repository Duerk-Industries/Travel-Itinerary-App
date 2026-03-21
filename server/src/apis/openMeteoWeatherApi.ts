import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow } from './usageLimiter';

type WeatherRequest = {
  date: string;
  location: string;
};

type GeocodedLocation = {
  latitude: number;
  longitude: number;
  name: string;
  admin1?: string | null;
  country?: string | null;
};

type WeatherDay = {
  date: string;
  temperatureHighC: number | null;
  weatherCode: number | null;
  icon: string;
  description: string;
};

type CachedValue<T> = {
  expiresAtMs: number;
  value: T;
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
  };
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    latitude?: number;
    longitude?: number;
    name?: string;
    admin1?: string | null;
    country?: string | null;
  }>;
};

export type OverviewWeatherResult = {
  date: string;
  requestedLocation: string;
  resolvedLocation: string;
  temperatureHighC: number | null;
  weatherCode: number | null;
  icon: string;
  description: string;
};

const geocodeCache = new Map<string, CachedValue<GeocodedLocation | null>>();
const forecastCache = new Map<string, CachedValue<Map<string, WeatherDay>>>();

const getGeocodeCacheTtlMs = (): number => {
  const minutes = getApiCacheSetting('weather', 'geocodeCacheTtlMinutes') ?? 60 * 24;
  return Math.max(1, minutes) * 60 * 1000;
};

const getForecastCacheTtlMs = (): number => {
  const minutes = getApiCacheSetting('weather', 'forecastCacheTtlMinutes') ?? 60;
  return Math.max(1, minutes) * 60 * 1000;
};

const normalizeLocationKey = (value: string): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

const toRoundedNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
};

const formatResolvedLocation = (location: GeocodedLocation): string =>
  [location.name, location.admin1, location.country].filter(Boolean).join(', ');

const toWeatherPresentation = (weatherCode: number | null | undefined): { icon: string; description: string } => {
  switch (weatherCode) {
    case 0:
      return { icon: '☀', description: 'Clear' };
    case 1:
    case 2:
      return { icon: '🌤', description: 'Partly cloudy' };
    case 3:
      return { icon: '☁', description: 'Cloudy' };
    case 45:
    case 48:
      return { icon: '🌫', description: 'Fog' };
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return { icon: '🌦', description: 'Drizzle' };
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
      return { icon: '🌧', description: 'Rain' };
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return { icon: '🌨', description: 'Snow' };
    case 95:
    case 96:
    case 99:
      return { icon: '⛈', description: 'Thunderstorm' };
    default:
      return { icon: '🌤', description: 'Weather' };
  }
};

const getCachedValue = <T>(cache: Map<string, CachedValue<T>>, key: string): { hit: boolean; value: T | null } => {
  const cached = cache.get(key);
  if (!cached) return { hit: false, value: null };
  if (cached.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: cached.value };
};

const setCachedValue = <T>(cache: Map<string, CachedValue<T>>, key: string, value: T, ttlMs: number): void => {
  cache.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
};

const geocodeLocation = async (
  location: string
): Promise<{ location: GeocodedLocation | null; apiCalls: number }> => {
  const normalized = normalizeLocationKey(location);
  if (!normalized) return { location: null, apiCalls: 0 };

  const cached = getCachedValue(geocodeCache, normalized);
  if (cached.hit) {
    return { location: cached.value, apiCalls: 0 };
  }

  reserveApiUsageOrThrow({ provider: 'OPEN_METEO', caller: 'OVERVIEW_DAY_WEATHER_GEOCODE' });
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    setCachedValue(geocodeCache, normalized, null, getGeocodeCacheTtlMs());
    return { location: null, apiCalls: 1 };
  }

  const data = (await res.json()) as OpenMeteoGeocodingResponse;
  const first = data?.results?.[0];
  const latitude = Number(first?.latitude);
  const longitude = Number(first?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    setCachedValue(geocodeCache, normalized, null, getGeocodeCacheTtlMs());
    return { location: null, apiCalls: 1 };
  }

  const result: GeocodedLocation = {
    latitude,
    longitude,
    name: String(first?.name ?? location).trim() || location,
    admin1: first?.admin1 ?? null,
    country: first?.country ?? null,
  };
  setCachedValue(geocodeCache, normalized, result, getGeocodeCacheTtlMs());
  return { location: result, apiCalls: 1 };
};

const fetchForecastRange = async (params: {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
}): Promise<{ days: Map<string, WeatherDay>; apiCalls: number }> => {
  const key = `${params.latitude.toFixed(4)},${params.longitude.toFixed(4)}:${params.startDate}:${params.endDate}`;
  const cached = getCachedValue(forecastCache, key);
  if (cached.hit && cached.value) {
    return { days: cached.value, apiCalls: 0 };
  }

  reserveApiUsageOrThrow({ provider: 'OPEN_METEO', caller: 'OVERVIEW_DAY_WEATHER_FORECAST' });
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(params.latitude))}` +
    `&longitude=${encodeURIComponent(String(params.longitude))}` +
    '&daily=weather_code,temperature_2m_max' +
    `&timezone=UTC&start_date=${encodeURIComponent(params.startDate)}&end_date=${encodeURIComponent(params.endDate)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    return { days: new Map<string, WeatherDay>(), apiCalls: 1 };
  }

  const data = (await res.json()) as OpenMeteoDailyResponse;
  const dates = Array.isArray(data?.daily?.time) ? data.daily?.time ?? [] : [];
  const weatherCodes = Array.isArray(data?.daily?.weather_code) ? data.daily?.weather_code ?? [] : [];
  const highs = Array.isArray(data?.daily?.temperature_2m_max) ? data.daily?.temperature_2m_max ?? [] : [];

  const byDate = new Map<string, WeatherDay>();
  dates.forEach((date, index) => {
    const weatherCode = Number.isFinite(Number(weatherCodes[index])) ? Number(weatherCodes[index]) : null;
    const presentation = toWeatherPresentation(weatherCode);
    byDate.set(date, {
      date,
      temperatureHighC: toRoundedNumber(highs[index]),
      weatherCode,
      icon: presentation.icon,
      description: presentation.description,
    });
  });

  setCachedValue(forecastCache, key, byDate, getForecastCacheTtlMs());
  return { days: byDate, apiCalls: 1 };
};

export const fetchOverviewWeather = async (
  requests: WeatherRequest[]
): Promise<{ weather: OverviewWeatherResult[]; apiCalls: number }> => {
  const normalizedRequests = requests
    .map((request) => ({
      date: String(request?.date ?? '').trim(),
      location: String(request?.location ?? '').trim(),
    }))
    .filter((request) => request.location && isIsoDate(request.date));

  if (!normalizedRequests.length) {
    return { weather: [], apiCalls: 0 };
  }

  let apiCalls = 0;
  const groupedByLocation = new Map<string, WeatherRequest[]>();
  normalizedRequests.forEach((request) => {
    const key = normalizeLocationKey(request.location);
    const bucket = groupedByLocation.get(key) ?? [];
    bucket.push(request);
    groupedByLocation.set(key, bucket);
  });

  const results: OverviewWeatherResult[] = [];
  for (const groupedRequests of groupedByLocation.values()) {
    const sample = groupedRequests[0];
    const geocoded = await geocodeLocation(sample.location);
    apiCalls += geocoded.apiCalls;
    if (!geocoded.location) continue;

    const sortedDates = groupedRequests.map((request) => request.date).sort((a, b) => a.localeCompare(b));
    const forecast = await fetchForecastRange({
      latitude: geocoded.location.latitude,
      longitude: geocoded.location.longitude,
      startDate: sortedDates[0],
      endDate: sortedDates[sortedDates.length - 1],
    });
    apiCalls += forecast.apiCalls;

    groupedRequests.forEach((request) => {
      const day = forecast.days.get(request.date);
      if (!day) return;
      results.push({
        date: request.date,
        requestedLocation: request.location,
        resolvedLocation: formatResolvedLocation(geocoded.location!),
        temperatureHighC: day.temperatureHighC,
        weatherCode: day.weatherCode,
        icon: day.icon,
        description: day.description,
      });
    });
  }

  results.sort((a, b) => `${a.date}:${a.requestedLocation}`.localeCompare(`${b.date}:${b.requestedLocation}`));
  return { weather: results, apiCalls };
};
