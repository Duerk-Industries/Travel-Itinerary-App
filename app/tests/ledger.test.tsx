import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import LedgerTab from '../tabs/ledger';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  lastRow: {},
  headerText: {},
  cellText: {},
};

describe('LedgerTab', () => {
  const trip = {
    id: 't1',
    currency: 'USD',
  };

  const groupMembers = [
    { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
    { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
  ];

  const expenses = [
    {
      id: 'e1',
      expenseDate: '2025-02-01',
      category: 'Breakfast',
      amount: 100,
      currency: 'USD',
      payerIds: ['m1'],
      forIds: ['m2'],
    },
    {
      id: 'e2',
      expenseDate: '2025-02-02',
      category: 'Other',
      amount: 100,
      currency: 'EUR',
      payerIds: ['m2'],
      forIds: ['m1', 'm2'],
    },
  ];
  const carRentals = [
    {
      id: 'c1',
      cost: '50',
      paidBy: ['m1'],
      travelerIds: ['m1'],
    },
  ];

  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { USD: 2 }, date: '2026-02-03' }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('computes paid and used totals with FX conversion', async () => {
    const { getAllByText } = render(
      <LedgerTab
        trip={trip}
        groupMembers={groupMembers}
        expenses={expenses}
        carRentals={carRentals}
        styles={styles}
      />
    );

    await waitFor(() => {
      expect(getAllByText('$200.00').length).toBeGreaterThan(0);
    });

    expect(getAllByText('$150.00').length).toBeGreaterThan(0);
  });

  it('shows matching paid/used totals in the overall row', async () => {
    const { getByTestId } = render(
      <LedgerTab
        trip={trip}
        groupMembers={groupMembers}
        expenses={expenses}
        carRentals={carRentals}
        styles={styles}
      />
    );

    const row = await waitFor(() => getByTestId('ledger-overall-row'));
    const { getAllByText } = within(row);
    expect(getAllByText('$350.00').length).toBeGreaterThan(0);
  });
});
