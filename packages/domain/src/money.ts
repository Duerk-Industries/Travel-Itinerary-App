export type ConversionStatus = 'converted' | 'unresolved';
export type ExpenseMoney = {
  amount: number | string;
  currency?: string | null;
  amountInTripCurrency?: number | string | null;
  exchangeRateToTripCurrency?: number | string | null;
  conversionCurrency?: string | null;
  conversionStatus?: ConversionStatus;
};

export const normalizeCurrency = (value: string | null | undefined, fallback = 'USD'): string =>
  value?.trim().toUpperCase() || fallback.toUpperCase();

export const currencyDigits = (currency: string): number => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: normalizeCurrency(currency) }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
};
export const roundMoney = (amount: number, currency: string): number => {
  const scale = 10 ** currencyDigits(currency);
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * scale) / scale;
};

/** Unknown conversions have no numeric value: callers must show a review notice. */
export const amountInTripCurrency = (expense: ExpenseMoney, tripCurrency: string): number | null => {
  const target = normalizeCurrency(tripCurrency), source = normalizeCurrency(expense.currency, target);
  const amount = Number(expense.amount);
  if (!Number.isFinite(amount)) return null;
  if (source === target || amount === 0) return roundMoney(amount, target);
  if (expense.conversionStatus === 'unresolved' || (expense.conversionCurrency && normalizeCurrency(expense.conversionCurrency) !== target)) return null;
  const rate = Number(expense.exchangeRateToTripCurrency);
  if (expense.exchangeRateToTripCurrency != null && Number.isFinite(rate) && rate > 0) return roundMoney(amount * rate, target);
  const converted = Number(expense.amountInTripCurrency);
  return expense.amountInTripCurrency != null && Number.isFinite(converted) ? roundMoney(converted, target) : null;
};

export const formatMoney = (amount: number, currency: string, locale = 'en-US'): string => {
  const code = normalizeCurrency(currency);
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'symbol' }).format(amount); }
  catch { return `${amount.toFixed(2)} ${code}`; }
};

export const formatExpenseMoney = (expense: ExpenseMoney, tripCurrency: string): string => {
  const target = normalizeCurrency(tripCurrency), source = normalizeCurrency(expense.currency, target);
  const original = formatMoney(Number(expense.amount) || 0, source);
  if (source === target) return original;
  const converted = amountInTripCurrency(expense, target);
  return `${original} · ${converted == null ? `Conversion unavailable (${target})` : formatMoney(converted, target)}`;
};
