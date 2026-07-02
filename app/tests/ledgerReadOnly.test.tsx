/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import LedgerTab from '../tabs/ledger';

const styles = {
  card: {},
  row: {},
  sectionTitle: {},
  helperText: {},
  button: {},
  smallButton: {},
  buttonText: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  headerText: {},
  cellText: {},
  dropdown: {},
  dropdownList: {},
  dropdownOption: {},
  input: {},
};

const trip = {
  id: 'trip-1',
  currency: 'USD',
  name: 'Test Trip',
};

const member = {
  id: 'member-1',
  firstName: 'Bryan',
  lastName: 'Traveler',
  email: 'bryan@example.com',
  status: 'active' as const,
};

describe('LedgerTab read-only mode', () => {
  test('hides Expense Covering section for followed trips', () => {
    const { queryByText } = render(
      <LedgerTab
        trip={trip}
        groupMembers={[member]}
        reportableMembers={[member]}
        paidTotals={{ 'member-1': 100 }}
        usedTotals={{ 'member-1': 100 }}
        styles={styles}
        downloadCsv={jest.fn()}
        findActiveTrip={() => trip}
        onNavigate={jest.fn()}
        coveredBy={{}}
        setCoveredBy={jest.fn()}
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        saveCoveredBy={jest.fn().mockResolvedValue(undefined)}
        readOnly
        payments={[]}
        currentUserMemberId={null}
        onAddPayment={async () => {}}
        onDeletePayment={async () => {}}
      />
    );

    expect(queryByText('Expense Covering')).toBeNull();
    expect(queryByText('Ledger')).toBeTruthy();
  });
});
