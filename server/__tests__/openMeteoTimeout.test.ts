/// <reference types="jest" />
// A slow or unreachable Open-Meteo must not stall pages that show weather (trip blog, overview).
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
jest.mock('../src/apis/providerBudgeting', () => ({ recordProviderRequestCost: jest.fn(async () => undefined) }));

import { fetchOverviewWeather } from '../src/apis/openMeteoWeatherApi';

describe('fetchOverviewWeather timeouts and off switch', () => {
  const originalFetch = global.fetch;
  const originalDisabled = process.env.OPEN_METEO_DISABLED;
  const originalTimeout = process.env.OPEN_METEO_TIMEOUT_MS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDisabled === undefined) delete process.env.OPEN_METEO_DISABLED; else process.env.OPEN_METEO_DISABLED = originalDisabled;
    if (originalTimeout === undefined) delete process.env.OPEN_METEO_TIMEOUT_MS; else process.env.OPEN_METEO_TIMEOUT_MS = originalTimeout;
  });

  it('gives up on a hung request and returns no weather instead of waiting', async () => {
    delete process.env.OPEN_METEO_DISABLED;
    process.env.OPEN_METEO_TIMEOUT_MS = '50';
    // Never resolves unless aborted, like a stalled connection.
    global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;

    const started = Date.now();
    const result = await fetchOverviewWeather([{ date: '2026-01-01', location: 'Hungville' }]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.weather.every((day) => day.temperatureHighC == null)).toBe(true);
  });

  it('makes no network calls when switched off', async () => {
    process.env.OPEN_METEO_DISABLED = '1';
    global.fetch = jest.fn() as unknown as typeof fetch;
    const result = await fetchOverviewWeather([{ date: '2026-01-01', location: 'Lisbon' }]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ weather: [], apiCalls: 0 });
  });
});
