import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import DailyExpensesTab from '../tabs/dailyExpenses';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  button: {},
  smallButton: {},
  buttonText: {},
  headerText: {},
  input: {},
  dropdown: {},
  selectButtonRow: {},
  selectCaret: {},
  dropdownList: {},
  dropdownOption: {},
  cellText: {},
  placeholderText: {},
  dateInputWrap: {},
  dateTouchable: {},
  dateIcon: {},
  payerBox: {},
  payerChips: {},
  payerChip: {},
  removeText: {},
  payerOptions: {},
  divider: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  lastRow: {},
  linkText: {},
  modalOverlay: {},
  modalCard: {},
  detailModal: {},
  detailModalScroll: {},
  tableActionButton: {},
  tableActionButtonDanger: {},
};

describe('DailyExpensesTab', () => {
  const trip = {
    id: 't1',
    groupId: 'g1',
    name: 'Test Trip',
    startDate: '2025-02-01',
    endDate: '2025-02-02',
    currency: 'EUR',
  };

  const groupMembers = [
    { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
    { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
  ];

  const expenses = [
    {
      id: 'e1',
      tripId: 't1',
      groupId: 'g1',
      userId: 'u1',
      expenseDate: '2025-02-01',
      category: 'Breakfast',
      amount: 12,
      currency: 'EUR',
      payerIds: ['m1'],
      forIds: ['m1', 'm2'],
      createdAt: '2025-02-01T10:00:00Z',
    },
  ];

  it('shows trip currency and opens detail modal on non-zero cell', () => {
    const { getByText, queryByTestId, getByTestId, getAllByText } = render(
      <DailyExpensesTab
        backendUrl="http://example.test"
        headers={{}}
        jsonHeaders={{}}
        trip={trip}
        groupMembers={groupMembers}
        expenses={expenses}
        setExpenses={() => {}}
        defaultPayerId="m1"
        styles={styles}
      />
    );

    fireEvent.press(getByText('+ Add Expense'));
    expect(getByText('EUR')).toBeTruthy();
    expect(queryByTestId('expense-detail-modal')).toBeNull();
    fireEvent.press(getAllByText('$12.00')[0]);
    expect(getByTestId('expense-detail-modal')).toBeTruthy();
  });
});
