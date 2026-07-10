/// <reference types="jest" />
/// <reference types="node" />
import { computePayerTotals as computeLedgerPayerTotals } from '../utils/costs';
import { computePayerTotals as computeReportPayerTotals } from '../tabs/costReport';
import { computeTripDays } from '../utils/createTripWizard';

const members = ['alice', 'bob', 'charlie'];

describe('Gemini test plan edge cases', () => {
  it('treats a same-day trip as a one-day itinerary', () => {
    expect(computeTripDays('2026-05-10', '2026-05-10')).toBe(1);
  });

  it('preserves cents when splitting an amount that does not divide evenly', () => {
    const expenses = [{ amount: 10, payerIds: members }];

    const ledgerTotals = computeLedgerPayerTotals(
      expenses,
      (expense) => expense.amount,
      (expense) => expense.payerIds,
      members
    );
    const reportTotals = computeReportPayerTotals(
      expenses,
      (expense) => expense.amount,
      (expense) => expense.payerIds,
      members
    );

    expect(ledgerTotals).toEqual({ alice: 3.34, bob: 3.33, charlie: 3.33 });
    expect(reportTotals).toEqual(ledgerTotals);
    expect(Object.values(ledgerTotals).reduce((sum, value) => sum + value, 0)).toBe(10);
  });

  it('preserves cents for negative expenses such as refunds', () => {
    const totals = computeLedgerPayerTotals(
      [{ amount: -10, payerIds: members }],
      (expense) => expense.amount,
      (expense) => expense.payerIds,
      members
    );

    expect(totals).toEqual({ alice: -3.34, bob: -3.33, charlie: -3.33 });
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(-10);
  });
});
