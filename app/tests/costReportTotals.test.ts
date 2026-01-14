import { describe, expect, test } from '@jest/globals';
import { balanceCategoryTotals } from '../tabs/costReport';

const sumValues = (obj: Record<string, number>) => Object.values(obj).reduce((sum, v) => sum + v, 0);

describe('Cost report balancing', () => {
  test('does not inflate totals when a single payer covers the full cost', () => {
    const members = ['bryan', 'vicky'];
    const totals = balanceCategoryTotals(80, { bryan: 80 }, members);
    expect(totals).toEqual({ bryan: 80, vicky: 0 });
    expect(sumValues(totals)).toBeCloseTo(80);
  });

  test('splits evenly when no payer data exists', () => {
    const members = ['bryan', 'vicky'];
    const totals = balanceCategoryTotals(90, {}, members);
    expect(totals.bryan).toBeCloseTo(45);
    expect(totals.vicky).toBeCloseTo(45);
    expect(sumValues(totals)).toBeCloseTo(90);
  });

  test('fills missing remainder across members while keeping the total intact', () => {
    const members = ['a', 'b', 'c'];
    const totals = balanceCategoryTotals(100, { a: 20 }, members);
    expect(sumValues(totals)).toBeCloseTo(100);
    expect(totals.a).toBeCloseTo(20 + 80 / 3);
    expect(totals.b).toBeCloseTo(80 / 3);
    expect(totals.c).toBeCloseTo(80 / 3);
  });

  test('overall sum across categories matches combined totals', () => {
    const members = ['bryan', 'vicky'];
    const flight = balanceCategoryTotals(80, { bryan: 80 }, members);
    const lodging = balanceCategoryTotals(60, {}, members);
    const tours = balanceCategoryTotals(30, { vicky: 30 }, members);

    const overall = members.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (flight[id] ?? 0) + (lodging[id] ?? 0) + (tours[id] ?? 0);
      return acc;
    }, {});

    expect(sumValues(overall)).toBeCloseTo(170);
    expect(overall.bryan).toBeCloseTo(80 + 30); // flight + lodging split
    expect(overall.vicky).toBeCloseTo(30 + 30); // lodging split + tour
  });
});
