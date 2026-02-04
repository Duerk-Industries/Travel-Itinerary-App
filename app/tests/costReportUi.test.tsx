import React from 'react';
import { render } from '@testing-library/react-native';
import CostReportTable from '../components/CostReportTable';
import { computePayerTotals } from '../tabs/costReport';

type Expense = {
  amount: number;
  category: string;
  payerIds: string[];
  forIds: string[];
};

const styles = {
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  headerText: {},
  cellText: {},
  lastRow: {},
};

const formatMemberName = (member: { firstName?: string; lastName?: string; email?: string }) =>
  `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || member.email || 'Traveler';

describe('CostReportTable', () => {
  test('renders multiple payer columns and matches ledger totals', () => {
    const members = [
      { id: 'm1', firstName: 'Bryan', lastName: 'Duerk' },
      { id: 'm2', email: 'ben.lundon@gmail.com' },
    ];
    const memberIds = members.map((m) => m.id);

    const expenses: Expense[] = [
      { amount: 100, category: 'Flights', payerIds: ['m1'], forIds: ['m1'] },
      { amount: 70, category: 'Lodging', payerIds: ['m2'], forIds: ['m2'] },
      { amount: 40, category: 'Tours', payerIds: ['m1'], forIds: ['m1'] },
    ];

    const ledgerTotals = computePayerTotals(
      expenses,
      (expense) => expense.amount,
      (expense) => expense.payerIds,
      memberIds
    );

    const rows = [
      { label: 'Flights', total: 100, shares: { m1: 100, m2: 0 } },
      { label: 'Lodging', total: 70, shares: { m1: 0, m2: 70 } },
      { label: 'Tours', total: 40, shares: { m1: 40, m2: 0 } },
    ];
    const overallShares = {
      m1: ledgerTotals.m1 ?? 0,
      m2: ledgerTotals.m2 ?? 0,
    };
    const overallCost = rows.reduce((sum, row) => sum + row.total, 0);

    const { getByText, getAllByText } = render(
      <CostReportTable
        rows={rows}
        members={members}
        overallShares={overallShares}
        overallCost={overallCost}
        styles={styles}
        formatMemberName={formatMemberName}
      />
    );

    expect(getByText('Bryan Duerk')).toBeTruthy();
    expect(getByText('ben.lundon@gmail.com')).toBeTruthy();
    expect(getAllByText('$100.00').length).toBeGreaterThan(0);
    expect(getAllByText('$70.00').length).toBeGreaterThan(0);
    expect(getAllByText('$40.00').length).toBeGreaterThan(0);
    expect(getAllByText(`$${overallCost.toFixed(2)}`).length).toBeGreaterThan(0);
  });
});
