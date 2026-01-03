import { describe, expect, test } from '@jest/globals';
import { computePayerTotals } from '../tabs/costReport';

type Tour = {
  id: string;
  name: string;
  cost: string | number;
  paidBy?: string[];
};

const addTour = (tours: Tour[], tour: Tour): Tour[] => [...tours, tour];

const removeTour = (tours: Tour[], id: string): Tour[] => tours.filter((t) => t.id !== id);

const payerTotalsForTours = (tours: Tour[], payerIds: string[]) =>
  computePayerTotals<Tour>(
    tours,
    (t: Tour) => Number(t.cost) || 0,
    (t: Tour) => t.paidBy ?? [],
    payerIds,
    { fallbackOnEmpty: false }
  );

describe('Tours', () => {
  test('adding a tour contributes its cost to payer totals', () => {
    const payers = ['alice', 'bob'];
    let tours: Tour[] = [];

    tours = addTour(tours, {
      id: 'tour-1',
      name: 'City walk',
      cost: '150',
      paidBy: payers,
    });

    const totals = payerTotalsForTours(tours, payers);
    expect(totals).toEqual({ alice: 75, bob: 75 });
  });

  test('removing a tour drops it from payer totals', () => {
    const payers = ['alice', 'bob'];
    let tours: Tour[] = [
      { id: 'tour-1', name: 'City walk', cost: 120, paidBy: payers },
      { id: 'tour-2', name: 'Museum', cost: 80, paidBy: ['alice'] },
    ];

    const totalsBefore = payerTotalsForTours(tours, payers);
    expect(totalsBefore).toEqual({ alice: 140, bob: 60 });

    tours = removeTour(tours, 'tour-2');

    const totalsAfter = payerTotalsForTours(tours, payers);
    expect(totalsAfter).toEqual({ alice: 60, bob: 60 });
  });

  test('tour costs split evenly across paidBy users', () => {
    const payers = ['alice', 'bob', 'charlie'];
    const tours: Tour[] = [{ id: 'tour-1', name: 'Food crawl', cost: 90, paidBy: payers }];

    const totals = payerTotalsForTours(tours, payers);
    expect(totals).toEqual({ alice: 30, bob: 30, charlie: 30 });
  });
});
