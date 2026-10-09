export type TemperatureUnit = 'fahrenheit' | 'celsius';

export const isTemperatureUnit = (value: unknown): value is TemperatureUnit =>
  value === 'fahrenheit' || value === 'celsius';

// Regions that use Fahrenheit day to day: the US and its territories, plus a handful of others.
const FAHRENHEIT_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'LR']);

/** Region code ("US", "GB", …) from a locale tag like "en-US" or "en_US", if it has one. */
export const regionFromLocale = (locale?: string | null): string | null => {
  const match = String(locale ?? '').match(/[-_]([A-Za-z]{2})(?:[-_@.]|$)/);
  return match ? match[1].toUpperCase() : null;
};

/**
 * Default unit for someone who hasn't picked one: Fahrenheit if the device/browser region is a
 * Fahrenheit region (the phone's Settings region, not GPS), Celsius elsewhere. Fahrenheit if the
 * region can't be determined.
 */
export const defaultTemperatureUnitForRegion = (locale?: string | null): TemperatureUnit => {
  let tag = locale;
  if (tag == null) {
    try {
      tag = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      tag = null;
    }
    if (!regionFromLocale(tag) && typeof navigator !== 'undefined') {
      tag = (navigator as any)?.language ?? tag;
    }
  }
  const region = regionFromLocale(tag);
  if (!region) return 'fahrenheit';
  return FAHRENHEIT_REGIONS.has(region) ? 'fahrenheit' : 'celsius';
};

export const normalizeTemperatureUnit = (value: unknown, fallback?: TemperatureUnit): TemperatureUnit =>
  isTemperatureUnit(value) ? value : (fallback ?? defaultTemperatureUnitForRegion());

export const formatTemperatureFromCelsius = (temperatureC: number, unit: TemperatureUnit): string => {
  if (unit === 'celsius') return `${Math.round(temperatureC)}°C`;
  return `${Math.round((temperatureC * 9) / 5 + 32)}°F`;
};

/**
 * Rewrites a weather fact like "⛅ 23°C" into the reader's unit. Uses the raw `temperatureHighC`
 * when the server sends it, else the °C number in the text (older cached facts).
 */
export const formatWeatherFactValue = (
  fact: { value?: string | null; icon?: string | null; temperatureHighC?: number | null },
  unit: TemperatureUnit,
): string => {
  const text = String(fact.value ?? '');
  const tempC = typeof fact.temperatureHighC === 'number'
    ? fact.temperatureHighC
    : (() => { const m = text.match(/(-?\d+(?:\.\d+)?)\s*°C/); return m ? Number(m[1]) : null; })();
  if (tempC == null || !Number.isFinite(tempC)) return text;
  const formatted = formatTemperatureFromCelsius(tempC, unit);
  return /-?\d+(?:\.\d+)?\s*°C/.test(text)
    ? text.replace(/-?\d+(?:\.\d+)?\s*°C/, formatted)
    : `${fact.icon ? `${fact.icon} ` : ''}${formatted}`.trim();
};
