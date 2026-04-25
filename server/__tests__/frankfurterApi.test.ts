jest.mock('../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/config/apiLimits', () => ({
  getApiCacheSetting: jest.fn(() => 60),
}));

import { clearFrankfurterRateCache, fetchFrankfurterExchangeRate } from '../src/apis/frankfurterApi';
import { reserveApiUsageOrThrow } from '../src/apis/usageLimiter';

const mockedReserve = reserveApiUsageOrThrow as jest.MockedFunction<typeof reserveApiUsageOrThrow>;

describe('fetchFrankfurterExchangeRate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearFrankfurterRateCache();
    mockedReserve.mockClear();
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('deduplicates concurrent requests for the same currency pair and date', async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    (global as any).fetch = fetchMock;

    const [first, second] = [
      fetchFrankfurterExchangeRate({
        caller: 'TEST',
        fromCurrency: 'usd',
        toCurrency: 'EUR',
        date: '2026-04-22',
      }),
      fetchFrankfurterExchangeRate({
        caller: 'TEST',
        fromCurrency: 'USD',
        toCurrency: 'eur',
        date: '2026-04-22',
      }),
    ];

    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedReserve).toHaveBeenCalledTimes(1);

    resolveFetch?.({
      ok: true,
      json: async () => ({ rates: { EUR: 0.92 }, date: '2026-04-22' }),
    } as Response);

    const firstResult = await first;
    const secondResult = await second;

    expect(firstResult).toEqual({ rate: 0.92, date: '2026-04-22' });
    expect(secondResult).toEqual({ rate: 0.92, date: '2026-04-22' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves cached rates without re-calling fetch or the usage limiter', async () => {
    const fetchMock = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ rates: { GBP: 0.79 }, date: '2026-04-22' }),
        }) as Response
    );
    (global as any).fetch = fetchMock;

    await fetchFrankfurterExchangeRate({
      caller: 'TEST',
      fromCurrency: 'USD',
      toCurrency: 'GBP',
      date: '2026-04-22',
    });
    await fetchFrankfurterExchangeRate({
      caller: 'TEST',
      fromCurrency: 'USD',
      toCurrency: 'GBP',
      date: '2026-04-22',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedReserve).toHaveBeenCalledTimes(1);
  });

  it('returns a rate of 1 for identical currencies without hitting the API', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const result = await fetchFrankfurterExchangeRate({
      caller: 'TEST',
      fromCurrency: 'USD',
      toCurrency: 'USD',
      date: '2026-04-22',
    });

    expect(result).toEqual({ rate: 1, date: '2026-04-22' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedReserve).not.toHaveBeenCalled();
  });
});
