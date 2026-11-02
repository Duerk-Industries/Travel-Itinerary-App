import { amountInTripCurrency, formatExpenseMoney, formatMoney } from '../../packages/domain/src/money';
import { buildAllExpenses, calculateAllTotals } from '../utils/costs';

describe('R2 shared currency totals', () => {
  const expenses = [
    { id: 'eur', amount: 60, currency: 'EUR', payerIds: ['a'], forIds: ['a'] },
    { id: 'usd', amount: 24, currency: 'USD', exchangeRateToTripCurrency: 0.9, conversionCurrency: 'EUR', payerIds: ['a'], forIds: ['a'] },
  ];
  it('uses the same converted amounts for day totals, Trip spend and Settle Up', () => {
    const dayTotal = expenses.reduce((sum, e) => sum + (amountInTripCurrency(e, 'EUR') ?? 0), 0);
    const all = buildAllExpenses([], [], [], [], expenses, 'EUR', ['a']);
    expect(dayTotal).toBe(81.6);
    expect(all.reduce((sum, e) => sum + e.amount, 0)).toBe(dayTotal);
    expect(calculateAllTotals(all, ['a'], ['a'], {}).ledgerPaidTotals.a).toBe(dayTotal);
    expect(formatExpenseMoney(expenses[1], 'EUR')).toBe('$24.00 · €21.60');
  });
  it('keeps unknown and stale conversions out of totals and flags them for display', () => {
    expect(amountInTripCurrency({ amount: 60, currency: 'EUR' }, 'USD')).toBeNull();
    expect(amountInTripCurrency({ ...expenses[1], conversionCurrency: 'GBP' }, 'EUR')).toBeNull();
    expect(formatExpenseMoney({ amount: 60, currency: 'EUR' }, 'USD')).toContain('Conversion unavailable');
    expect(buildAllExpenses([], [], [], [], [{ amount: 60, currency: 'EUR' }], 'USD', ['a'])[0]).toMatchObject({ amount: 0, conversionStatus: 'unresolved' });
  });
  it('converts booking mirrors once while preserving the original booking currency', () => {
    const all = buildAllExpenses([{ id: 'f', cost: 60, currency: 'EUR' }], [], [], [], [
      { sourceType: 'flight', sourceId: 'f', amount: 60, currency: 'EUR', exchangeRateToTripCurrency: 1.1, conversionCurrency: 'USD' },
    ], 'USD', ['a']);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ amount: 66, originalCurrency: 'EUR', currency: 'USD' });
  });
  it('formats non-dollar and zero-decimal currencies', () => {
    expect(formatMoney(60, 'EUR')).toBe('€60.00');
    expect(formatMoney(600, 'JPY')).toBe('¥600');
  });
});
