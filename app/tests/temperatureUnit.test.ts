/// <reference types="jest" />
import {
  defaultTemperatureUnitForRegion,
  formatWeatherFactValue,
  normalizeTemperatureUnit,
  regionFromLocale,
} from '../utils/temperatureUnit';

describe('regionFromLocale', () => {
  it('reads the region from common locale tag shapes', () => {
    expect(regionFromLocale('en-US')).toBe('US');
    expect(regionFromLocale('en_GB')).toBe('GB');
    expect(regionFromLocale('es-MX')).toBe('MX');
    expect(regionFromLocale('zh-Hans-CN')).toBe('CN');
    expect(regionFromLocale('en')).toBeNull();
    expect(regionFromLocale(null)).toBeNull();
  });
});

describe('defaultTemperatureUnitForRegion', () => {
  it('uses Fahrenheit for the US and its territories', () => {
    expect(defaultTemperatureUnitForRegion('en-US')).toBe('fahrenheit');
    expect(defaultTemperatureUnitForRegion('es-PR')).toBe('fahrenheit');
  });

  it('uses Celsius everywhere else', () => {
    expect(defaultTemperatureUnitForRegion('en-GB')).toBe('celsius');
    expect(defaultTemperatureUnitForRegion('en-CA')).toBe('celsius');
    expect(defaultTemperatureUnitForRegion('de-DE')).toBe('celsius');
  });

  it('falls back to Fahrenheit when the region is unknown', () => {
    expect(defaultTemperatureUnitForRegion('en')).toBe('fahrenheit');
  });
});

describe('normalizeTemperatureUnit', () => {
  it('keeps a saved choice over the region default', () => {
    expect(normalizeTemperatureUnit('celsius', 'fahrenheit')).toBe('celsius');
    expect(normalizeTemperatureUnit('fahrenheit', 'celsius')).toBe('fahrenheit');
  });

  it('uses the fallback when nothing valid is saved', () => {
    expect(normalizeTemperatureUnit(null, 'celsius')).toBe('celsius');
    expect(normalizeTemperatureUnit('kelvin', 'fahrenheit')).toBe('fahrenheit');
  });
});

describe('formatWeatherFactValue', () => {
  it('converts from the raw temperature when the server sends it', () => {
    expect(formatWeatherFactValue({ value: '⛅ 23°C', icon: '⛅', temperatureHighC: 23 }, 'fahrenheit')).toBe('⛅ 73°F');
    expect(formatWeatherFactValue({ value: '⛅ 23°C', icon: '⛅', temperatureHighC: 23 }, 'celsius')).toBe('⛅ 23°C');
  });

  it('converts older cached facts that only have the °C text', () => {
    expect(formatWeatherFactValue({ value: '🌧 -2°C' }, 'fahrenheit')).toBe('🌧 28°F');
  });

  it('leaves text without a temperature alone', () => {
    expect(formatWeatherFactValue({ value: '☀️' }, 'fahrenheit')).toBe('☀️');
  });
});
