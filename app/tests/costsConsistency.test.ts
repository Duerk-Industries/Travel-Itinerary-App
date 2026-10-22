/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { buildAllExpenses } from '../utils/costs';

describe('costs consistency', () => {
  test('splits air and every ground transfer type without counting booking expenses twice', () => {
    const types = ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'];
    const bookings = types.map((transferType, index) => ({ id: `t${index}`, transferType, cost: 100, passengerIds: ['m1'], paidBy: ['m2'] }));
    const all = buildAllExpenses([...bookings, { id: 'legacy', cost: 50 }], [], [], [], [
      { id: 'mirrored', sourceType: 'flight', sourceId: 't1', category: 'Flights', amount: 100 },
    ], 'USD', ['m1', 'm2']);
    expect(all.filter(item => item.category === 'Flights').reduce((sum, item) => sum + item.amount, 0)).toBe(150);
    const ground = all.filter(item => item.category === 'Ground Transfers');
    expect(ground).toHaveLength(5);
    expect(ground.reduce((sum, item) => sum + item.amount, 0)).toBe(500);
    expect(ground[0].payerIds).toEqual(['m2']);
    expect(ground[0].forIds).toEqual(['m1']);
    expect(all.reduce((sum, item) => sum + item.amount, 0)).toBe(650);
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
