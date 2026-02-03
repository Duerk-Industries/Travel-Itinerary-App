type ExchangeRateResult = {
  rate: number;
  date: string;
};

const rateCache = new Map<string, ExchangeRateResult>();

const pad = (value: number): string => String(value).padStart(2, '0');

export const getLocalDateString = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const buildKey = (from: string, to: string, date: string): string =>
  `${from.toUpperCase()}-${to.toUpperCase()}-${date}`;

export const fetchExchangeRate = async (
  fromCurrency: string,
  toCurrency: string,
  date: string
): Promise<ExchangeRateResult | null> => {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (!from || !to) return null;
  if (from === to) {
    return { rate: 1, date };
  }
  const key = buildKey(from, to, date);
  const cached = rateCache.get(key);
  if (cached) return cached;

  const url = `https://api.frankfurter.dev/v1/${encodeURIComponent(date)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { rates?: Record<string, number>; date?: string };
  const rate = data?.rates?.[to];
  if (!rate || Number.isNaN(Number(rate))) return null;
  const result = { rate: Number(rate), date: data?.date ?? date };
  rateCache.set(key, result);
  return result;
};
