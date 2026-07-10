/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { buildAllExpenses } from '../utils/costs';

describe('costs consistency', () => {
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
