import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow } from './usageLimiter';

type ExchangeRateResult = {
  rate: number;
  date: string;
};

type CacheEntry = {
  value: ExchangeRateResult;
  expiresAtMs: number;
};

const rateCache = new Map<string, CacheEntry>();

const getCacheTtlMs = (): number => {
  const minutes = getApiCacheSetting('frankfurter', 'rateCacheTtlMinutes') ?? 60 * 24;
  return Math.max(1, minutes) * 60 * 1000;
};

const buildKey = (fromCurrency: string, toCurrency: string, date: string): string =>
  `${fromCurrency.toUpperCase()}-${toCurrency.toUpperCase()}-${date}`;

export const fetchFrankfurterExchangeRate = async (params: {
  caller: string;
  fromCurrency: string;
  toCurrency: string;
  date: string;
}): Promise<ExchangeRateResult | null> => {
  const from = String(params.fromCurrency ?? '').trim().toUpperCase();
  const to = String(params.toCurrency ?? '').trim().toUpperCase();
  const date = String(params.date ?? '').trim();
  if (!from || !to || !date) return null;
  if (from === to) return { rate: 1, date };

  const key = buildKey(from, to, date);
  const cached = rateCache.get(key);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.value;
  }

  reserveApiUsageOrThrow({ provider: 'FRANKFURTER', caller: params.caller });

  const url = `https://api.frankfurter.dev/v1/${encodeURIComponent(date)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { rates?: Record<string, number>; date?: string };
  const rate = Number(data?.rates?.[to]);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const result = {
    rate,
    date: String(data?.date ?? date),
  };
  rateCache.set(key, { value: result, expiresAtMs: Date.now() + getCacheTtlMs() });
  return result;
};
