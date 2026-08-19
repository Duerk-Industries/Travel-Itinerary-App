/// <reference types="jest" />
/// <reference types="node" />
// archive-api.open-meteo.com has been observed taking 60+ seconds to respond on some networks
// with no request-level timeout, stalling itinerary generation for a purely optional enrichment
// (see the TypeError: fetch failed reports at climatologyDaylightService.ts's call site). This
// locks in that fetchMonthlyClimatology now bounds the request with an abort signal and degrades
// gracefully (returns null, doesn't throw) when the upstream is slow or unreachable.
import { fetchMonthlyClimatology, clearClimatologyCacheForTests } from '../src/services/climatologyDaylightService';

jest.mock('../src/apis/usageLimiter', () => ({
  ...jest.requireActual('../src/apis/usageLimiter'),
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));
jest.mock('../src/apis/providerBudgeting', () => ({
  ...jest.requireActual('../src/apis/providerBudgeting'),
  recordProviderRequestCost: jest.fn(async () => undefined),
}));

describe('fetchMonthlyClimatology', () => {
  beforeEach(() => {
    clearClimatologyCacheForTests();
  });

  it('passes an AbortSignal to the fetch call so a slow upstream cannot hang indefinitely', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ daily: { time: ['2025-07-15'], temperature_2m_max: [30], temperature_2m_min: [20], precipitation_sum: [0] } }),
    })) as unknown as typeof fetch;

    await fetchMonthlyClimatology({ lat: 48.85, lon: 2.35, month: 7, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('degrades to null instead of throwing when the upstream request is aborted', async () => {
    // Simulates what a real AbortSignal.timeout() firing looks like against a slow
    // archive-api host: undici rejects the fetch call with a TimeoutError.
    const fetchImpl = jest.fn(async () => {
      throw new DOMException('The operation was aborted.', 'TimeoutError');
    }) as unknown as typeof fetch;

    const result = await fetchMonthlyClimatology({ lat: 48.85, lon: 2.35, month: 7, fetchImpl });

    // The existing catch-and-cache-null path (not a rejected promise) is what keeps a slow
    // climatology lookup from failing the whole itinerary generation job.
    expect(result).toBe(null);
  });
});
