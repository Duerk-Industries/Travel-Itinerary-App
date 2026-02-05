/**
 * @jest-environment node
 */

import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import LedgerTab from '../tabs/ledger';
import { computePayerTotals } from '../utils/costs';
import { rollUpTotals } from '../utils/coveredBy';

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
  headerText: {},
  cellText: {},
  row: {},
  button: {},
  smallButton: {},
};

describe('LedgerTab with expense covering', () => {
  const trip = { id: 't1', currency: 'USD' };
  const groupMembers = [
    { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
    { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
    { id: 'm3', firstName: 'Casey', lastName: 'Morgan', status: 'active' as const },
  ];
  const coveredBy = { m2: 'm1' };
  const reportableMembers = groupMembers.filter((m) => !coveredBy[m.id]);

  const expenses = [
    { amount: 100, payerIds: ['m2'], forIds: ['m2'] },
    { amount: 60, payerIds: ['m3'], forIds: ['m2', 'm3'] },
    { amount: 40, payerIds: ['m1'], forIds: ['m1'] },
  ];

  const rawPaid = computePayerTotals(expenses, (e) => e.amount, (e) => e.payerIds, groupMembers.map((m) => m.id));
  const rawUsed = computePayerTotals(expenses, (e) => e.amount, (e) => e.forIds, groupMembers.map((m) => m.id));
  const paidTotals = rollUpTotals(rawPaid, coveredBy);
  const usedTotals = rollUpTotals(rawUsed, coveredBy);

  const downloadCsv = jest.fn();
  const findActiveTrip = () => trip;

  it('rolls up covered traveler totals and hides them in the ledger', async () => {
    const { getByTestId, queryByTestId } = render(
      <LedgerTab
        trip={trip}
        groupMembers={groupMembers}
        reportableMembers={reportableMembers}
        paidTotals={paidTotals}
        usedTotals={usedTotals}
        styles={styles}
        downloadCsv={downloadCsv}
        findActiveTrip={findActiveTrip}
        onNavigate={() => {}}
        coveredBy={coveredBy}
        setCoveredBy={jest.fn()}
        formatMemberName={(member) => `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}
        payerName={(id) => id}
        saveCoveredBy={async () => {}}
      />
    );

    expect(queryByTestId('ledger-row-m2')).toBeNull();

    const alexRow = await waitFor(() => getByTestId('ledger-row-m1'));
    expect(within(alexRow).getByText('$140.00')).toBeTruthy();
    expect(within(alexRow).getByText('$170.00')).toBeTruthy();

    const caseyRow = await waitFor(() => getByTestId('ledger-row-m3'));
    expect(within(caseyRow).getByText('$60.00')).toBeTruthy();
    expect(within(caseyRow).getByText('$30.00')).toBeTruthy();
  });
});
