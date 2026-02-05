import { describe, expect, test } from '@jest/globals';
import { balanceCategoryTotals, computePayerTotals } from '../tabs/costReport';
import { rollUpTotals } from '../utils/coveredBy';

type Expense = {
  amount: number;
  amountInTripCurrency?: number | null;
  category: string;
  payerIds: string[];
  forIds: string[];
};

type Flight = { cost: number; paidBy: string[] };
type Lodging = { totalCost: string; paidBy: string[] };
type Tour = { cost: string; paidBy: string[] };
type CarRental = { cost: string; paidBy: string[] };

const getExpenseAmount = (expense: Expense) => Number(expense.amountInTripCurrency ?? expense.amount) || 0;

describe('Ledger vs Cost Report totals with covering', () => {
  test('overall cost report shares match ledger paid totals after rollups', () => {
    const memberIds = ['m1', 'm2', 'm3'];
    const coveredBy = { m2: 'm1' };
    const reportableMemberIds = memberIds.filter((id) => !coveredBy[id]);

    const flights: Flight[] = [{ cost: 300, paidBy: ['m2'] }];
    const lodgings: Lodging[] = [{ totalCost: '200', paidBy: ['m2'] }];
    const tours: Tour[] = [{ cost: '120', paidBy: ['m1', 'm3'] }];
    const carRentals: CarRental[] = [{ cost: '90', paidBy: ['m3'] }];

    const expenses: Expense[] = [
      { amount: 40, category: 'Breakfast', payerIds: ['m1'], forIds: ['m2'] },
      { amount: 60, category: 'Lunch', payerIds: ['m2'], forIds: ['m1', 'm2'] },
      { amount: 30, category: 'Dinner', payerIds: ['m3'], forIds: ['m3'] },
      { amount: 300, category: 'Flights', payerIds: ['m2'], forIds: ['m2'] },
      { amount: 200, category: 'Lodging', payerIds: ['m2'], forIds: ['m1', 'm2', 'm3'] },
      { amount: 120, category: 'Tours', payerIds: ['m1', 'm3'], forIds: ['m1', 'm3'] },
    ];

    const expenseCategories = ['Breakfast', 'Lunch', 'Dinner', 'Other Food', 'Rides', 'Souvenirs', 'Other'];
    const expenseItems = expenses.filter((expense) => expenseCategories.includes(expense.category));
    const expenseTotalsByCategory: Record<string, number> = {};
    expenseCategories.forEach((cat) => {
      expenseTotalsByCategory[cat] = 0;
    });
    expenseItems.forEach((expense) => {
      expenseTotalsByCategory[expense.category] =
        (expenseTotalsByCategory[expense.category] ?? 0) + getExpenseAmount(expense);
    });

    const flightsTotal = flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0);
    const lodgingsTotal = lodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0);
    const toursTotal = tours.reduce((sum, t) => sum + (Number(t.cost) || 0), 0);
    const carRentalsTotal = carRentals.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

    const flightShares = balanceCategoryTotals(
      flightsTotal,
      rollUpTotals(computePayerTotals(flights, (f) => Number(f.cost) || 0, (f) => f.paidBy, memberIds, { fallbackOnEmpty: false }), coveredBy),
      reportableMemberIds
    );
    const lodgingShares = balanceCategoryTotals(
      lodgingsTotal,
      rollUpTotals(computePayerTotals(lodgings, (l) => Number(l.totalCost) || 0, (l) => l.paidBy, memberIds, { fallbackOnEmpty: false }), coveredBy),
      reportableMemberIds
    );
    const tourShares = balanceCategoryTotals(
      toursTotal,
      rollUpTotals(computePayerTotals(tours, (t) => Number(t.cost) || 0, (t) => t.paidBy, memberIds, { fallbackOnEmpty: false }), coveredBy),
      reportableMemberIds
    );
    const carRentalShares = balanceCategoryTotals(
      carRentalsTotal,
      rollUpTotals(computePayerTotals(carRentals, (r) => Number(r.cost) || 0, (r) => r.paidBy, memberIds, { fallbackOnEmpty: false }), coveredBy),
      reportableMemberIds
    );

    const expenseSharesByCategory: Record<string, Record<string, number>> = {};
    expenseCategories.forEach((category) => {
      const items = expenseItems.filter((expense) => expense.category === category);
      const totals = rollUpTotals(
        computePayerTotals(
          items,
          (expense) => getExpenseAmount(expense),
          (expense) => expense.payerIds,
          memberIds,
          { fallbackOnEmpty: false }
        ),
        coveredBy
      );
      expenseSharesByCategory[category] = balanceCategoryTotals(expenseTotalsByCategory[category] ?? 0, totals, reportableMemberIds);
    });

    const expenseOverallShares: Record<string, number> = {};
    reportableMemberIds.forEach((id) => {
      expenseOverallShares[id] = 0;
    });
    expenseCategories.forEach((category) => {
      reportableMemberIds.forEach((id) => {
        expenseOverallShares[id] = (expenseOverallShares[id] ?? 0) + (expenseSharesByCategory[category]?.[id] ?? 0);
      });
    });

    const overallShares: Record<string, number> = {};
    reportableMemberIds.forEach((id) => {
      overallShares[id] =
        (flightShares[id] ?? 0) +
        (lodgingShares[id] ?? 0) +
        (tourShares[id] ?? 0) +
        (carRentalShares[id] ?? 0) +
        (expenseOverallShares[id] ?? 0);
    });

    const ledgerPaidTotals = rollUpTotals(
      computePayerTotals(expenses, (expense) => getExpenseAmount(expense), (expense) => expense.payerIds, memberIds),
      coveredBy
    );
    const ledgerPaidWithRentals = rollUpTotals(
      computePayerTotals(carRentals, (rental) => Number(rental.cost) || 0, (rental) => rental.paidBy, memberIds),
      coveredBy
    );

    reportableMemberIds.forEach((id) => {
      const ledgerTotal = (ledgerPaidTotals[id] ?? 0) + (ledgerPaidWithRentals[id] ?? 0);
      expect(ledgerTotal).toBeCloseTo(overallShares[id] ?? 0);
    });
  });
});
