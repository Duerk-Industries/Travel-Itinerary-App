/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DailyExpensesTab from '../tabs/dailyExpenses';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('auto', null);

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
  dangerButton: {},
  dangerButtonText: {},
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
        theme={theme}
        headers={{}}
        jsonHeaders={{}}
        trip={trip}
        groupMembers={groupMembers}
        expenses={expenses}
        setExpenses={() => {}}
        defaultPayerId="m1"
        styles={styles}
        costTrackingAllowed
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

  it('deletes a daily (in-grid) expense from the category detail dialog', async () => {
    const setExpenses = jest.fn();
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as any);
    (global as any).fetch = fetchMock;

    const screen = render(
      <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
        groupMembers={groupMembers} expenses={expenses} setExpenses={setExpenses} defaultPayerId="m1" styles={styles} costTrackingAllowed />
    );

    fireEvent.press(screen.getAllByText('$12.00')[0]); // open the Breakfast · Feb 1 detail dialog
    fireEvent.press(screen.getByTestId('expense-delete-e1'));
    // The confirm is inline inside the detail dialog (a second stacked Modal can hide behind it on web).
    expect(screen.getByTestId('expense-detail-delete-confirm')).toBeTruthy();
    fireEvent.press(screen.getByTestId('expense-detail-delete-confirm-yes'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://example.test/api/expenses/e1', expect.objectContaining({ method: 'DELETE' })));
    expect(setExpenses).toHaveBeenCalled();
  });

  it('surfaces and deletes expenses the daily grid cannot reach (wrong category or date)', async () => {
    const setExpenses = jest.fn();
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as any);
    (global as any).fetch = fetchMock;

    const list = [
      ...expenses,
      { id: 'act-1', tripId: 't1', groupId: 'g1', userId: 'u1', expenseDate: '2025-02-01', category: 'Activities', amount: 63.71, currency: 'EUR', payerIds: ['m1'], forIds: ['m1'], createdAt: '', sourceType: 'activity', sourceId: 'a1' },
      { id: 'act-0', tripId: 't1', groupId: 'g1', userId: 'u1', expenseDate: '2025-02-02', category: 'Activities', amount: 0, currency: 'EUR', payerIds: ['m1'], forIds: ['m1'], createdAt: '', sourceType: 'activity', sourceId: 'a2' },
      { id: 'old-1', tripId: 't1', groupId: 'g1', userId: 'u1', expenseDate: '2024-12-25', category: 'Lunch', amount: 9, currency: 'EUR', payerIds: ['m1'], forIds: ['m1'], createdAt: '' },
    ];

    const screen = render(
      <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
        groupMembers={groupMembers} expenses={list as any} setExpenses={setExpenses} defaultPayerId="m1" styles={styles} costTrackingAllowed />
    );

    // The grid can't show any of these three; the "Other expenses" table does.
    expect(screen.getByText('Other expenses (3)')).toBeTruthy();
    expect(screen.getByTestId('other-expense-row-act-1')).toBeTruthy();
    expect(screen.getByTestId('other-expense-row-old-1')).toBeTruthy();
    // e1 (Breakfast, in range) stays in the grid, not here.
    expect(screen.queryByTestId('other-expense-row-e1')).toBeNull();

    fireEvent.press(screen.getByTestId('expense-delete-act-1'));
    fireEvent.press(screen.getByLabelText('Delete')); // ConfirmDialog confirm
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://example.test/api/expenses/act-1', expect.objectContaining({ method: 'DELETE' })));
    expect(setExpenses).toHaveBeenCalled();

    // The bulk "remove zero-amount" shortcut only shows with 2+ zero entries; here there is 1.
    expect(screen.queryByTestId('other-expenses-clear-zero')).toBeNull();
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
          theme={theme}
          headers={{ Authorization: 'Bearer token' }}
          jsonHeaders={{ Authorization: 'Bearer token', 'Content-Type': 'application/json' }}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={setExpenses}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
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
