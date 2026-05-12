/**
 * @jest-environment node
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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
      vendor: 'Cafe Nero',
      notes: 'Coffee and pastries',
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
    expect(getByText('Cafe Nero')).toBeTruthy();
    expect(getByText('Coffee and pastries')).toBeTruthy();
  });

  it('sends vendor and notes when creating a daily expense', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...expenses[0],
        id: 'e2',
        amount: 18.75,
        vendor: 'Flour Bakery',
        notes: 'Receipt reviewed',
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as any;
    const setExpenses = jest.fn();

    try {
      const { getByText, getByPlaceholderText } = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          headers={{ Authorization: 'Bearer token' }}
          jsonHeaders={{ Authorization: 'Bearer token', 'Content-Type': 'application/json' }}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={setExpenses}
          defaultPayerId="m1"
          styles={styles}
        />
      );

      fireEvent.press(getByText('+ Add Expense'));
      fireEvent.changeText(getByPlaceholderText('Amount'), '18.75');
      fireEvent.changeText(getByPlaceholderText('Vendor'), 'Flour Bakery');
      fireEvent.changeText(getByPlaceholderText('Notes'), 'Receipt reviewed');
      fireEvent.press(getByText('Save Expense'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://example.test/api/expenses',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual(expect.objectContaining({
        vendor: 'Flour Bakery',
        notes: 'Receipt reviewed',
        amount: 18.75,
      }));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
