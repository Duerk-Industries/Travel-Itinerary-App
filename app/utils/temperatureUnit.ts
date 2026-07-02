export type TemperatureUnit = 'fahrenheit' | 'celsius';

export const isTemperatureUnit = (value: unknown): value is TemperatureUnit =>
  value === 'fahrenheit' || value === 'celsius';

export const normalizeTemperatureUnit = (value: unknown, fallback: TemperatureUnit = 'fahrenheit'): TemperatureUnit =>
  isTemperatureUnit(value) ? value : fallback;

export const formatTemperatureFromCelsius = (temperatureC: number, unit: TemperatureUnit): string => {
  if (unit === 'celsius') return `${Math.round(temperatureC)}°C`;
  return `${Math.round((temperatureC * 9) / 5 + 32)}°F`;
};
