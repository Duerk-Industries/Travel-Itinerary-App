import { quoteExpense, resolveExpenses } from '../src/services/tripMoneyService';
import { historicalExchangeRate } from '../src/services/historicalExchangeRates';
import { getDbAdapter } from '../src/db.providers';
import type { Expense, TripMoneyMetadata } from '../src/types';
jest.mock('../src/db.providers', () => ({ getDbAdapter: jest.fn() }));
jest.mock('../src/services/historicalExchangeRates', () => ({ historicalExchangeRate: jest.fn() }));

describe('R2 authoritative conversions', () => {
  let saved: TripMoneyMetadata[];
  let currency: string;
  beforeEach(() => {
    saved = []; currency = 'EUR';
    (getDbAdapter as jest.Mock).mockReturnValue({
      getTripById: async () => ({ currency }),
      getTripMoneyMetadata: async () => saved,
      saveTripMoneyMetadata: async (rows: TripMoneyMetadata[]) => { saved = [...rows]; },
    });
    (historicalExchangeRate as jest.Mock).mockReset().mockResolvedValue({ rate: 0.9, date: '2026-06-12' });
  });
  const expense = { id: 'e', tripId: 't', amount: 24, currency: 'USD', expenseDate: '2026-06-13' } as Expense;
  it('quotes the expense date and ignores client conversion values', async () => {
    const result = await quoteExpense({ ...expense, amountInTripCurrency: 999 } as Expense);
    expect(historicalExchangeRate).toHaveBeenCalledWith('USD', 'EUR', '2026-06-13');
    expect(result).toMatchObject({ amountInTripCurrency: 21.6, conversionCurrency: 'EUR', exchangeRateDate: '2026-06-12' });
  });
  it('persists historical backfills and reuses their saved rates', async () => {
    expect((await resolveExpenses([expense]))[0].amountInTripCurrency).toBe(21.6);
    expect(saved[0].conversionCurrency).toBe('EUR');
    (historicalExchangeRate as jest.Mock).mockClear();
    expect((await resolveExpenses([expense]))[0].amountInTripCurrency).toBe(21.6);
    expect(historicalExchangeRate).not.toHaveBeenCalled();
  });
  it('requotes after changing the trip currency rather than relabeling a quote', async () => {
    await resolveExpenses([expense]);
    currency = 'GBP';
    (historicalExchangeRate as jest.Mock).mockResolvedValue({ rate: 0.75, date: '2026-06-12' });
    expect((await resolveExpenses([expense]))[0]).toMatchObject({ amountInTripCurrency: 18, conversionCurrency: 'GBP' });
  });
  it('requotes when the expense date changes', async () => {
    await resolveExpenses([expense]);
    (historicalExchangeRate as jest.Mock).mockClear();
    await resolveExpenses([{ ...expense, expenseDate: '2026-07-01' }]);
    expect(historicalExchangeRate).toHaveBeenCalledWith('USD', 'EUR', '2026-07-01');
  });
  it('returns an explicit unresolved conversion when historical data is unavailable', async () => {
    (historicalExchangeRate as jest.Mock).mockResolvedValue(null);
    expect((await resolveExpenses([expense]))[0]).toMatchObject({ amount: 24, amountInTripCurrency: null, exchangeRateToTripCurrency: null, conversionStatus: 'unresolved' });
  });
});
