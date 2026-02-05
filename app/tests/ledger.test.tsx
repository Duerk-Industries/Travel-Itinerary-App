/**
 * @jest-environment node
 */

import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import LedgerTab from '../tabs/ledger';
import { computePayerTotals } from '../utils/costs';

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
  row: {},
  button: {},
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
  const downloadCsv = jest.fn();
  const findActiveTrip = () => trip;

  const allExpenses = [
    ...expenses.map((e) => ({
      ...e,
      amountInTripCurrency: e.currency === 'EUR' ? e.amount * 2 : e.amount,
    })),
    ...carRentals.map((c) => ({
      ...c,
      amount: Number(c.cost),
      currency: 'USD',
      amountInTripCurrency: Number(c.cost),
      forIds: c.travelerIds,
      payerIds: c.paidBy,
    })),
  ];

  const paidTotals = computePayerTotals(
    allExpenses,
    (e) => e.amountInTripCurrency ?? e.amount,
    (e) => e.payerIds,
    groupMembers.map((m) => m.id)
  );

  const usedTotals = computePayerTotals(
    allExpenses,
    (e) => e.amountInTripCurrency ?? e.amount,
    (e) => e.forIds,
    groupMembers.map((m) => m.id)
  );

  it('computes paid and used totals with FX conversion', async () => {
    const { getByTestId } = render(
      <LedgerTab trip={trip} groupMembers={groupMembers} paidTotals={paidTotals} usedTotals={usedTotals} styles={styles} downloadCsv={downloadCsv} findActiveTrip={findActiveTrip} onNavigate={() => {}} />
    );

    // Alex (m1) Paid: 100 (e1) + 50 (c1) = 150, Used: 100 (e2/2) + 50 (c1) = 150
    // Blair (m2) Paid: 100 * 2 (e2) = 200, Used: 100 (e1) + 100 (e2/2) = 200
    const alexRow = await waitFor(() => getByTestId('ledger-row-m1'));
    expect(within(alexRow).getAllByText('$150.00')).toHaveLength(2);

    const blairRow = await waitFor(() => getByTestId('ledger-row-m2'));
    expect(within(blairRow).getAllByText('$200.00')).toHaveLength(2);
  });

  it('shows matching paid/used totals in the overall row', async () => {
    const { getByTestId } = render(
      <LedgerTab trip={trip} groupMembers={groupMembers} paidTotals={paidTotals} usedTotals={usedTotals} styles={styles} downloadCsv={downloadCsv} findActiveTrip={findActiveTrip} onNavigate={() => {}} />
    );

    const row = await waitFor(() => getByTestId('ledger-overall-row'));
    const { getAllByText } = within(row);
    expect(getAllByText('$350.00').length).toBeGreaterThan(0);
  });

  it('handles undefined memberIds in computePayerTotals', () => {
    const totals = computePayerTotals(
      [{ amount: 42, ids: ['m1'] }],
      (item) => item.amount,
      (item) => item.ids,
      undefined,
      { fallbackOnEmpty: true }
    );
    expect(totals).toEqual({});
  });
});
