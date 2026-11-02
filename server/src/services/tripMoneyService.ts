import { getDbAdapter } from '../db.providers';
import type { Expense, TripMoneyMetadata } from '../types';
import { normalizeCurrency, roundMoney } from '../utils/money';
import { historicalExchangeRate } from './historicalExchangeRates';

type MoneyInput = { tripId: string; amount: number; currency?: string | null; expenseDate: string };
export const quoteExpense = async (expense: MoneyInput) => {
  const trip = await getDbAdapter().getTripById(expense.tripId);
  const target = normalizeCurrency(trip?.currency);
  const currency = normalizeCurrency(expense.currency, target);
  const rawDate: unknown = expense.expenseDate;
  const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);
  const quote = await historicalExchangeRate(currency, target, date);
  return { currency, conversionCurrency: target,
    amountInTripCurrency: quote ? roundMoney(Number(expense.amount) * quote.rate, target) : null,
    exchangeRateToTripCurrency: quote?.rate ?? null, exchangeRateDate: quote?.date ?? null,
    conversionStatus: quote ? 'converted' as const : 'unresolved' as const };
};

export const expenseMetadata = (expense: Expense): TripMoneyMetadata => ({
  recordType: 'expense', recordId: expense.id, tripId: expense.tripId, expenseDate: expense.expenseDate,
  currency: expense.currency, amount: Number(expense.amount), conversionCurrency: expense.conversionCurrency ?? null,
  amountInTripCurrency: expense.amountInTripCurrency ?? null,
  exchangeRateToTripCurrency: expense.exchangeRateToTripCurrency ?? null, exchangeRateDate: expense.exchangeRateDate ?? null,
});

export const saveExpenseMoney = async (expense: Expense, remember = false): Promise<Expense> => {
  await getDbAdapter().saveTripMoneyMetadata([expenseMetadata(expense)]);
  if (remember && !expense.sourceType) await getDbAdapter().setLastExpenseCurrency(expense.userId, expense.tripId, expense.currency);
  return expense;
};

export const resolveExpenses = async (expenses: Expense[]): Promise<Expense[]> => {
  if (!expenses.length) return [];
  const db = getDbAdapter();
  const metadata = new Map((await db.getTripMoneyMetadata('expense', expenses.map(e => e.id))).map(m => [m.recordId, m]));
  const trips = new Map(await Promise.all([...new Set(expenses.map(e => e.tripId))].map(async id => [id, await db.getTripById(id)] as const)));
  const result: Expense[] = [];
  const changed: TripMoneyMetadata[] = [];
  // Sequential work bounds provider traffic; requests with the same pair/date share the quote cache.
  for (const expense of expenses) {
    const target = normalizeCurrency(trips.get(expense.tripId)?.currency);
    const currency = normalizeCurrency(expense.currency, target);
    const saved = metadata.get(expense.id);
    let resolved: Expense;
    if (saved && saved.currency === currency && Number(saved.amount) === Number(expense.amount) && saved.conversionCurrency === target && saved.expenseDate === expense.expenseDate && saved.exchangeRateToTripCurrency != null) {
      resolved = { ...expense, ...{ amountInTripCurrency: saved.amountInTripCurrency, exchangeRateToTripCurrency: saved.exchangeRateToTripCurrency, exchangeRateDate: saved.exchangeRateDate }, currency, conversionCurrency: target, conversionStatus: 'converted' };
    } else if (!saved && expense.exchangeRateToTripCurrency != null && Number(expense.exchangeRateToTripCurrency) > 0) {
      // Legacy quotes are captured against the old trip currency before settings can change it.
      resolved = { ...expense, currency, conversionCurrency: target, conversionStatus: 'converted' };
      changed.push(expenseMetadata(resolved));
    } else {
      resolved = { ...expense, ...await quoteExpense({ ...expense, currency }) };
      changed.push(expenseMetadata(resolved));
    }
    result.push(resolved);
  }
  await db.saveTripMoneyMetadata(changed);
  return result;
};

type Booking = { id: string; currency?: string | null; tripId?: string | null; trip_id?: string | null; cost?: number | null; totalCost?: number | null; total_cost?: number | null; date?: string | null; departureDate?: string | null; departure_date?: string | null; check_in_date?: string | null; checkInDate?: string | null; pickupDate?: string | null };
export const bookingCurrency = async <T extends Booking>(kind: TripMoneyMetadata['recordType'], item: T, requested?: string | null): Promise<T> => {
  const db = getDbAdapter();
  const tripId = item.tripId ?? item.trip_id;
  if (!tripId) return item;
  const previous = (await db.getTripMoneyMetadata(kind, [item.id]))[0];
  const target = normalizeCurrency((await db.getTripById(tripId))?.currency);
  const currency = normalizeCurrency(requested ?? previous?.currency ?? item.currency, target);
  const amount = Number(item.cost ?? item.totalCost ?? item.total_cost ?? 0);
  // An undated activity carries date '' (not null); a blank must fall through to the next date, or the DATE column rejects it.
  const rawDate: unknown = ([item.date, item.departureDate, item.departure_date, item.checkInDate, item.check_in_date, item.pickupDate] as unknown[]).find(value => value instanceof Date || String(value ?? '').trim()) ?? new Date().toISOString().slice(0, 10);
  const expenseDate = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);
  const quote = previous?.currency === currency && previous.conversionCurrency === target && Number(previous.amount) === amount && previous.expenseDate === expenseDate && previous.exchangeRateToTripCurrency != null
    ? { currency, conversionCurrency: target, amountInTripCurrency: previous.amountInTripCurrency, exchangeRateToTripCurrency: previous.exchangeRateToTripCurrency, exchangeRateDate: previous.exchangeRateDate, conversionStatus: 'converted' as const }
    : await quoteExpense({ tripId, amount, currency, expenseDate });
  if (!previous || previous.currency !== currency || previous.conversionCurrency !== target || Number(previous.amount) !== amount || previous.expenseDate !== expenseDate || previous.exchangeRateToTripCurrency !== quote.exchangeRateToTripCurrency || previous.amountInTripCurrency !== quote.amountInTripCurrency) await db.saveTripMoneyMetadata([{
    recordType: kind, recordId: item.id, tripId, currency, amount, expenseDate,
    conversionCurrency: quote.conversionCurrency, amountInTripCurrency: quote.amountInTripCurrency, exchangeRateToTripCurrency: quote.exchangeRateToTripCurrency, exchangeRateDate: quote.exchangeRateDate,
  }]);
  return { ...item, ...quote };
};
