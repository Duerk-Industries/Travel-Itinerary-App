/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { buildAllExpenses, calculateAllTotals } from '../utils/costs';

describe('costs consistency', () => {
  test('uses the trip creator as the single fallback payer without changing who shares the costs', () => {
    const members = ['other', 'creator'];
    const expenses = buildAllExpenses(
      [{ id: 'flight', cost: 100, passengerIds: members }],
      [{ id: 'hotel', totalCost: 100, travelerIds: members }],
      [{ id: 'activity', cost: 100, travelerIds: members }],
      [{ id: 'car', cost: 100, travelerIds: members }],
      [{ id: 'daily', amount: 100, forIds: members }], 'USD', members, 'creator');
    expect(expenses).toHaveLength(5);
    expenses.forEach((expense) => {
      expect(expense.payerIds).toEqual(['creator']);
      expect(expense.forIds).toEqual(members);
    });
    const totals = calculateAllTotals(expenses, members, members, {});
    expect(totals.ledgerPaidTotals).toEqual({ other: 0, creator: 500 });
    expect(totals.ledgerUsedTotals).toEqual({ other: 250, creator: 250 });
    expect(totals.finalBalances).toEqual({ other: -250, creator: 250 });
  });

  test('preserves an explicit payer and resolves legacy multi-payer lists just like the editor', () => {
    const expenses = buildAllExpenses([
      { id: 'explicit', cost: 20, paidBy: ['other'] },
      { id: 'legacy', cost: 40, paidBy: ['other', 'creator'] },
    ], [], [], [], [{ id: 'daily', amount: 10, payerIds: ['other', 'creator'] }], 'USD', ['creator', 'other'], 'creator');
    expenses.forEach((expense) => expect(expense.payerIds).toEqual(['other']));
  });

  test.each(['transferType', 'transfer_type'])('keeps per-person paid, incurred and covered balances correct across separate transfer categories (%s)', (typeField) => {
    const members = ['m1', 'm2', 'm3'];
    const expenses = buildAllExpenses([
      { id: 'air', [typeField]: 'Flight', cost: 100.01, paidBy: ['m1', 'm2'], passengerIds: ['m2', 'm3'] },
      { id: 'rail', [typeField]: 'Train', cost: 45.01, paid_by: ['m3'], passenger_ids: ['m1', 'm2'] },
    ], [], [], [], [], 'USD', members);
    const air = expenses.filter(item => item.category === 'Flights');
    const ground = expenses.filter(item => item.category === 'Ground Transfers');
    expect(air).toHaveLength(1);
    expect(ground).toHaveLength(1);
    const airTotals = calculateAllTotals(air, members, members, {});
    const groundTotals = calculateAllTotals(ground, members, members, {});
    expect(airTotals.ledgerPaidTotals.m1).toBe(100.01);
    expect(airTotals.ledgerPaidTotals.m2).toBe(0);
    expect(airTotals.ledgerUsedTotals.m2).toBe(50.01);
    expect(airTotals.ledgerUsedTotals.m3).toBe(50);
    expect(groundTotals.ledgerPaidTotals.m3).toBe(45.01);
    expect(groundTotals.ledgerUsedTotals.m1).toBe(22.51);
    expect(groundTotals.ledgerUsedTotals.m2).toBe(22.5);
    const combined = calculateAllTotals(expenses, members, members, {});
    members.forEach(id => {
      expect(combined.finalBalances[id]).toBeCloseTo(airTotals.finalBalances[id] + groundTotals.finalBalances[id], 8);
    });
    expect(Object.values(combined.finalBalances).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(0, 8);
    const covered = calculateAllTotals(expenses, members, ['m1', 'm2'], { m3: 'm1' });
    expect(covered.finalBalances.m1).toBeCloseTo(72.51, 8);
    expect(covered.finalBalances.m2).toBeCloseTo(-72.51, 8);
  });
  test('splits air and every ground transfer type without counting booking expenses twice', () => {
    const types = ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other', 'Public Transit', 'Private Transfer'];
    const bookings = types.map((transferType, index) => ({ id: `t${index}`, transferType, cost: 100, passengerIds: ['m1'], paidBy: ['m2'] }));
    const all = buildAllExpenses([...bookings, { id: 'legacy', cost: 50 }], [], [], [], [
      { id: 'mirrored', sourceType: 'flight', sourceId: 't1', category: 'Flights', amount: 100 },
    ], 'USD', ['m1', 'm2']);
    expect(all.filter(item => item.category === 'Flights').reduce((sum, item) => sum + item.amount, 0)).toBe(150);
    const ground = all.filter(item => item.category === 'Ground Transfers');
    expect(ground).toHaveLength(7);
    expect(ground.reduce((sum, item) => sum + item.amount, 0)).toBe(700);
    expect(ground[0].payerIds).toEqual(['m2']);
    expect(ground[0].forIds).toEqual(['m1']);
    expect(all.reduce((sum, item) => sum + item.amount, 0)).toBe(850);
  });
  test('does not double count source expenses for flights', () => {
    const flights = [
      {
        id: 'f1',
        cost: 2084,
        paidBy: ['m1'],
        passengerIds: ['m1'],
        departureDate: '2025-11-15',
        carrier: 'Test',
        flightNumber: 'T1',
      },
    ];
    const expenses = [
      {
        id: 'e1',
        expenseDate: '2025-11-15',
        category: 'Flights',
        amount: 2084,
        payerIds: ['m1'],
        forIds: ['m1'],
        sourceType: 'flight',
      },
    ];
    const all = buildAllExpenses(flights, [], [], [], expenses, 'USD', ['m1']);
    const flightItems = all.filter((e) => e.category === 'Flights');
    const total = flightItems.reduce((sum, e) => sum + e.amount, 0);
    expect(flightItems).toHaveLength(1);
    expect(total).toBe(2084);
  });

  test('uses tour travelerIds for incurred totals when present', () => {
    const tours = [
      {
        id: 't1',
        cost: 120,
        paidBy: ['m1'],
        travelerIds: ['m2', 'm3'],
        date: '2025-02-01',
        name: 'Tour',
      },
    ];
    const all = buildAllExpenses([], [], tours, [], [], 'USD', ['m1', 'm2', 'm3']);
    expect(all[0].payerIds).toEqual(['m1']);
    expect(all[0].forIds).toEqual(['m2', 'm3']);
  });
});
