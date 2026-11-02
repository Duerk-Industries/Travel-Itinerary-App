import { getEnvFlag } from '../env';

type Quote = { rate: number; date: string };
const cache = new Map<string, { expires: number; promise: Promise<Quote | null> }>();

/** Use the expense date (or today's latest available quote for a future expense). */
export const historicalExchangeRate = async (from: string, to: string, expenseDate: string): Promise<Quote | null> => {
  if (from === to) return { rate: 1, date: expenseDate.slice(0, 10) };
  if (getEnvFlag('EXCHANGE_RATES_DISABLED')) return null;
  const today = new Date().toISOString().slice(0, 10);
  const date = expenseDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const asOf = date > today ? today : date;
  const key = `${from}:${to}:${asOf}`;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const promise = (async (): Promise<Quote | null> => {
    try {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from}/${to}?date=${asOf}`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const body = await response.json() as { rate?: unknown; date?: unknown };
      const rate = Number(body.rate);
      return Number.isFinite(rate) && rate > 0 && typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.date <= asOf
        ? { rate, date: body.date } : null;
    } catch { return null; }
  })();
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 300_000, promise });
  return promise;
};
