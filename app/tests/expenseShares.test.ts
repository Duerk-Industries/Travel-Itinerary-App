import { buildAllExpenses, calculateAllTotals, computePayerTotals, splitAmountByWeights } from '../utils/costs';
import { convertExpensesToCsv } from '../utils/csv';

const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

describe('splitAmountByWeights', () => {
  it('splits in proportion to the weights', () => {
    expect(splitAmountByWeights(60, [2, 1])).toEqual([40, 20]);
    expect(splitAmountByWeights(100, [1, 1, 2])).toEqual([25, 25, 50]);
  });

  it('always adds back up to the amount, to the cent', () => {
    for (const [amount, weights] of [[10, [1, 1, 1]], [0.07, [3, 1, 1]], [100.01, [2, 5, 3]], [33.33, [1, 1]]] as Array<[number, number[]]>) {
      expect(sum(splitAmountByWeights(amount, weights))).toBe(amount);
    }
  });

  it('equal weights give the usual equal split', () => {
    expect(splitAmountByWeights(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
  });

  it('treats a missing or invalid weight as one share', () => {
    expect(splitAmountByWeights(30, [0, NaN, 1])).toEqual([10, 10, 10]);
  });
});

describe('uneven expense splits', () => {
  const members = ['a', 'b', 'c'];
  const expense = { id: 'e1', expenseDate: '2026-11-12', category: 'Dinner', amount: 60, payerIds: ['a'], forIds: ['a', 'b'], forShares: { a: 1, b: 2 } };

  it('charges each person their weighted share and leaves everyone else out', () => {
    const totals = computePayerTotals([expense], (e) => e.amount, (e) => e.forIds, members, { fallbackOnEmpty: true, getWeights: (e) => e.forShares });
    expect(totals).toEqual({ a: 20, b: 40, c: 0 });
  });

  it('ignores the weights when the expense falls back to everyone', () => {
    const everyone = { ...expense, forIds: [] as string[] };
    const totals = computePayerTotals([everyone], (e) => e.amount, (e) => e.forIds, members, { fallbackOnEmpty: true, getWeights: (e) => e.forShares });
    expect(totals).toEqual({ a: 20, b: 20, c: 20 });
  });

  it('flows through the ledger: what each person used and the balances', () => {
    const all = buildAllExpenses([], [], [], [], [expense], 'USD', members, 'a');
    const { ledgerPaidTotals, ledgerUsedTotals, finalBalances } = calculateAllTotals(all, members, members, {});
    expect(ledgerPaidTotals.a).toBe(60);
    expect(ledgerUsedTotals).toMatchObject({ a: 20, b: 40, c: 0 });
    expect(finalBalances).toMatchObject({ a: 40, b: -40, c: 0 });
  });

  it('an expense without weights splits equally as before', () => {
    const all = buildAllExpenses([], [], [], [], [{ ...expense, forShares: undefined }], 'USD', members, 'a');
    expect(calculateAllTotals(all, members, members, {}).ledgerUsedTotals).toMatchObject({ a: 30, b: 30, c: 0 });
  });

  it('the CSV export uses the weights, adding up the weights of people covered by the same member', () => {
    const csv = (coveredBy: Record<string, string>) =>
      convertExpensesToCsv({
        expenses: [{ date: '2026-11-12', category: 'Dinner', description: 'Tapas', amount: 60, payerIds: ['a'], forIds: ['a', 'b'], forShares: { a: 1, b: 2 } }],
        members: [{ id: 'a', firstName: 'A' }, { id: 'b', firstName: 'B' }, { id: 'c', firstName: 'C' }],
        formatMemberName: (m) => String(m.firstName),
        coveredBy,
        expenseType: 'incurred',
      }).split('\n')[1];
    expect(csv({})).toBe('2026-11-12,Dinner,Tapas,20.00,40.00,0.00');
    expect(csv({ b: 'c' })).toBe('2026-11-12,Dinner,Tapas,20.00,0.00,40.00');
  });
});
