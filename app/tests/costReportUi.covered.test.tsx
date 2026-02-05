/**
 * @jest-environment node
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import CostReportTable from '../components/CostReportTable';
import { computePayerTotals } from '../tabs/costReport';
import { rollUpTotals } from '../utils/coveredBy';

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

describe('CostReportTable with expense covering', () => {
  test('hides covered travelers and rolls totals up to the coverer', () => {
    const members = [
      { id: 'm1', firstName: 'Alex', lastName: 'Rider' },
      { id: 'm2', email: 'blair@example.com' },
      { id: 'm3', email: 'casey@example.com' },
    ];
    const coveredBy = { m2: 'm1' };
    const reportableMembers = members.filter((m) => !coveredBy[m.id]);
    const memberIds = members.map((m) => m.id);

    const expenses: Expense[] = [
      { amount: 100, category: 'Flights', payerIds: ['m2'], forIds: ['m2'] },
      { amount: 70, category: 'Lodging', payerIds: ['m3'], forIds: ['m2', 'm3'] },
    ];

    const ledgerTotals = rollUpTotals(
      computePayerTotals(expenses, (expense) => expense.amount, (expense) => expense.payerIds, memberIds),
      coveredBy
    );

    const rows = [
      { label: 'Flights', total: 100, shares: rollUpTotals({ m2: 100 }, coveredBy) },
      { label: 'Lodging', total: 70, shares: rollUpTotals({ m3: 70 }, coveredBy) },
    ];
    const overallShares = {
      m1: ledgerTotals.m1 ?? 0,
      m3: ledgerTotals.m3 ?? 0,
    };
    const overallCost = rows.reduce((sum, row) => sum + row.total, 0);

    const { getByText, queryByText } = render(
      <CostReportTable
        rows={rows}
        members={reportableMembers}
        overallShares={overallShares}
        overallCost={overallCost}
        styles={styles}
        formatMemberName={formatMemberName}
      />
    );

    expect(getByText('Alex Rider')).toBeTruthy();
    expect(getByText('casey@example.com')).toBeTruthy();
    expect(queryByText('blair@example.com')).toBeNull();
    expect(getByText(`$${overallCost.toFixed(2)}`)).toBeTruthy();
  });
});
