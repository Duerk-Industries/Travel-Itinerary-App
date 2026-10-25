/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Platform } from 'react-native';
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

  beforeEach(() => {
    window.localStorage.clear();
  });

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
        receiptScanningAllowed
      />
    );

    fireEvent.press(getByText('+ Add Expense'));
    expect(getByText('EUR')).toBeTruthy();
    expect(queryByTestId('expense-detail-modal')).toBeNull();
    fireEvent.press(getAllByText('$12.00')[0]);
    expect(getByTestId('expense-detail-modal')).toBeTruthy();
    // Description column shows the vendor (falling back to notes).
    expect(getByText('Cafe Nero')).toBeTruthy();
  });

  it('has a Settle Up button that opens the Balances page, and omits it when the viewer cannot open it', () => {
    const common = {
      backendUrl: 'http://example.test', theme, headers: {}, jsonHeaders: {}, trip, groupMembers, expenses,
      setExpenses: () => {}, defaultPayerId: 'm1', styles, costTrackingAllowed: true,
    };
    const onOpenBalances = jest.fn();
    const withButton = render(<DailyExpensesTab {...common} onOpenBalances={onOpenBalances} />);
    fireEvent.press(withButton.getByTestId('expense-balances-button'));
    expect(onOpenBalances).toHaveBeenCalledTimes(1);
    expect(withButton.getByText('Settle Up')).toBeTruthy();
    withButton.unmount();

    const withoutButton = render(<DailyExpensesTab {...common} />);
    expect(withoutButton.queryByTestId('expense-balances-button')).toBeNull();
  });

  it('fills the Description with just the merchant name after a scan and shows review guidance in the dialog', async () => {
    const originalOS = Platform.OS;
    const originalFetch = global.fetch;
    Platform.OS = 'web';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ expenseDate: '2025-02-01', expenseTime: '19:30', amount: 45.5, currency: 'EUR', vendor: 'Carul Cu Bere', category: 'Dinner', notes: null }),
    })) as any;
    try {
      const screen = render(
        <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
          groupMembers={groupMembers} expenses={expenses} setExpenses={() => {}} defaultPayerId="m1" styles={styles} costTrackingAllowed receiptScanningAllowed />
      );
      const file = new File(['img'], 'receipt.jpg', { type: 'image/jpeg' });
      await act(async () => { fireEvent(screen.UNSAFE_getByProps({ 'data-testid': 'expense-receipt-input' }), 'change', { target: { files: [file] } }); });

      await waitFor(() => expect(screen.getByTestId('expense-add-modal')).toBeTruthy());
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Carul Cu Bere');
      expect(screen.getByTestId('expense-receipt-review-notice').props.children).toMatch(/Check the amount, date and category/);

      fireEvent.press(screen.getByTestId('expense-cancel'));
      fireEvent.press(screen.getByTestId('expense-add-button'));
      expect(screen.queryByTestId('expense-receipt-review-notice')).toBeNull();
    } finally {
      Platform.OS = originalOS;
      global.fetch = originalFetch;
    }
  });

  it('notes in the dialog, not the Description, when the receipt date is outside the trip', async () => {
    const originalOS = Platform.OS;
    const originalFetch = global.fetch;
    Platform.OS = 'web';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ expenseDate: '2024-06-01', amount: 10, currency: 'EUR', vendor: 'Cafe Nero', category: 'Breakfast', notes: null }),
    })) as any;
    try {
      const screen = render(
        <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
          groupMembers={groupMembers} expenses={expenses} setExpenses={() => {}} defaultPayerId="m1" styles={styles} costTrackingAllowed receiptScanningAllowed />
      );
      await act(async () => {
        fireEvent(screen.UNSAFE_getByProps({ 'data-testid': 'expense-receipt-input' }), 'change', { target: { files: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] } });
      });
      await waitFor(() => expect(screen.getByTestId('expense-receipt-review-notice')).toBeTruthy());
      expect(screen.getByTestId('expense-receipt-review-notice').props.children).toMatch(/outside this trip's dates/);
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Cafe Nero');
    } finally {
      Platform.OS = originalOS;
      global.fetch = originalFetch;
    }
  });

  it('hides receipt scanning when the user is not entitled', () => {
    const screen = render(
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
        receiptScanningAllowed={false}
      />
    );

    expect(screen.queryByTestId('expense-scan-receipt-button')).toBeNull();
    expect(screen.queryByTestId('expense-receipt-input')).toBeNull();
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

  it('edits a daily expense from the category detail dialog', async () => {
    const setExpenses = jest.fn();
    const updatedExpense = { ...expenses[0], amount: 18.75, vendor: 'Flour Bakery', notes: null };
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => updatedExpense }) as any);
    const originalFetch = global.fetch;
    global.fetch = fetchMock as any;

    try {
      const screen = render(
        <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{ Authorization: 'Bearer token' }} jsonHeaders={{ Authorization: 'Bearer token', 'Content-Type': 'application/json' }} trip={trip}
          groupMembers={groupMembers} expenses={expenses} setExpenses={setExpenses} defaultPayerId="m1" styles={styles} costTrackingAllowed />
      );

      fireEvent.press(screen.getAllByText('$12.00')[0]);
      fireEvent.press(screen.getByTestId('expense-edit-e1'));
      expect(screen.getByText('Edit Expense')).toBeTruthy();
      expect(screen.getByPlaceholderText('Description').props.value).toBe('Cafe Nero');
      expect(screen.queryByPlaceholderText('Notes')).toBeNull();

      fireEvent.changeText(screen.getByPlaceholderText('Amount'), '18.75');
      fireEvent.changeText(screen.getByPlaceholderText('Description'), 'Flour Bakery');
      fireEvent.press(screen.getByText('Save Changes'));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        'http://example.test/api/expenses/e1',
        expect.objectContaining({ method: 'PUT' }),
      ));
      const body = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
      expect(body).toEqual(expect.objectContaining({ amount: 18.75, vendor: 'Flour Bakery' }));
      expect(body.notes).toBeUndefined();
      expect(setExpenses).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not allow expense mutations while cached trip data is read-only', async () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock as any;

    try {
      const screen = render(
        <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
          groupMembers={groupMembers} expenses={expenses} setExpenses={() => {}} defaultPayerId="m1" styles={styles} costTrackingAllowed receiptScanningAllowed readOnly />
      );

      expect(screen.getByTestId('expense-add-button').props.disabled).toBe(true);
      expect(screen.getByTestId('expense-scan-receipt-button').props.disabled).toBe(true);
      expect(screen.getByTestId('expense-import-button').props.disabled).toBe(true);
      // Testing Library can invoke an onPress even when a native Touchable is
      // disabled. Exercise that stale/programmatic path too: Save still must
      // not post an expense while the cached trip is read-only.
      fireEvent.press(screen.getByTestId('expense-add-button'));
      expect(screen.getByTestId('expense-add-modal')).toBeTruthy();
      fireEvent.press(screen.getByText('Save Expense'));
      expect(fetchMock).not.toHaveBeenCalled();

      // The delete handler has the same protection for an already-open stale
      // control.
      fireEvent.press(screen.getAllByText('$12.00')[0]);
      fireEvent.press(screen.getByTestId('expense-delete-e1'));
      fireEvent.press(screen.getByTestId('expense-detail-delete-confirm-yes'));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  describe('offline add', () => {
    const queueExpense = jest.fn();
    const renderOffline = (overrides: Record<string, unknown> = {}) =>
      render(
        <DailyExpensesTab backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
          groupMembers={groupMembers} expenses={expenses} setExpenses={() => {}} defaultPayerId="m1" styles={styles}
          costTrackingAllowed readOnly allowOfflineAdd
          pendingExpenses={{ entries: [], syncedNotice: null, queueExpense, retryEntry: jest.fn(), discardEntry: jest.fn() }}
          {...overrides} />
      );

    beforeEach(() => {
      queueExpense.mockReset();
    });

    it('lets a new expense be saved on this device without any network request, and closes the form', async () => {
      queueExpense.mockResolvedValue('entry-1');
      const fetchMock = jest.fn();
      const originalFetch = global.fetch;
      global.fetch = fetchMock as any;
      try {
        const screen = renderOffline();
        expect(screen.getByTestId('expense-add-button').props.disabled).toBe(false);
        // Editing, scanning and importing stay unavailable offline.
        expect(screen.getByTestId('expense-import-button').props.disabled).toBe(true);

        fireEvent.press(screen.getByTestId('expense-add-button'));
        fireEvent.changeText(screen.getByPlaceholderText('Amount'), '18.75');
        fireEvent.changeText(screen.getByPlaceholderText('Description'), 'Flour Bakery');
        fireEvent.press(screen.getByText('Save Expense'));

        await waitFor(() => expect(queueExpense).toHaveBeenCalledTimes(1));
        const args = queueExpense.mock.calls[0][0];
        expect(args.operationKey).toMatch(/^exp_/);
        expect(args.payload).toEqual(expect.objectContaining({ tripId: 't1', amount: 18.75, vendor: 'Flour Bakery', payerIds: ['m1'] }));
        await waitFor(() => expect(screen.queryByTestId('expense-add-modal')).toBeNull());
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('keeps the form open and says nothing was saved when the device storage refuses the write', async () => {
      queueExpense.mockResolvedValue(null);
      const screen = renderOffline();
      fireEvent.press(screen.getByTestId('expense-add-button'));
      fireEvent.changeText(screen.getByPlaceholderText('Amount'), '5');
      fireEvent.press(screen.getByText('Save Expense'));
      await waitFor(() => expect(queueExpense).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('expense-add-modal')).toBeTruthy();
    });

    it('queues instead of failing when the connection drops while saving online', async () => {
      queueExpense.mockResolvedValue('entry-2');
      const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
      const originalFetch = global.fetch;
      global.fetch = fetchMock as any;
      try {
        const screen = renderOffline({ readOnly: false });
        fireEvent.press(screen.getByTestId('expense-add-button'));
        fireEvent.changeText(screen.getByPlaceholderText('Amount'), '9.5');
        fireEvent.press(screen.getByText('Save Expense'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(queueExpense).toHaveBeenCalledTimes(1));
        // Same operation key on the attempt and the queued retry, so the server can dedupe.
        const sentKey = fetchMock.mock.calls[0][1].headers['Idempotency-Key'];
        expect(queueExpense.mock.calls[0][0].operationKey).toBe(sentKey);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('lists waiting expenses with a plain status and offers Try again only for ones that failed', () => {
      const retryEntry = jest.fn();
      const discardEntry = jest.fn();
      const base = { enqueuedAtMs: 1, attempts: 0, kind: 'createExpense' };
      const payload = { tripId: 't1', expenseDate: '2025-02-01', category: 'Dinner', amount: 30, currency: 'EUR', payerIds: ['m1'], forIds: ['m1'] };
      const screen = renderOffline({
        pendingExpenses: {
          entries: [
            { ...base, id: 'w1', status: 'pending', args: { operationKey: 'exp_aaaaaaaa', payload } },
            { ...base, id: 'f1', status: 'failed', lastError: 'You no longer have access to this trip.', args: { operationKey: 'exp_bbbbbbbb', payload: { ...payload, amount: 12 } } },
            { ...base, id: 'o1', status: 'pending', args: { operationKey: 'exp_cccccccc', payload: { ...payload, tripId: 'other-trip' } } },
          ],
          syncedNotice: '2 offline expenses synced',
          queueExpense,
          retryEntry,
          discardEntry,
        },
      });
      expect(screen.getByText('Saved on this device · waiting to sync')).toBeTruthy();
      expect(screen.getByText('2 offline expenses synced')).toBeTruthy();
      expect(screen.getByText('Waiting to sync')).toBeTruthy();
      expect(screen.getByText("Couldn't sync: You no longer have access to this trip.")).toBeTruthy();
      expect(screen.queryByTestId('expense-pending-o1')).toBeNull();
      expect(screen.getAllByLabelText('Try syncing this expense again')).toHaveLength(1);

      fireEvent.press(screen.getByLabelText('Try syncing this expense again'));
      expect(retryEntry).toHaveBeenCalledWith('f1');

      fireEvent.press(within(screen.getByTestId('expense-pending-f1')).getByLabelText('Discard this expense'));
      expect(discardEntry).not.toHaveBeenCalled();
      fireEvent.press(screen.getByLabelText('Discard', { exact: true }));
      expect(discardEntry).toHaveBeenCalledWith('f1');
    });
  });

  it('does not show Other Expenses on the Daily Expenses page', () => {
    const paidActivity = { ...expenses[0], id: 'paid-activity', category: 'Activities', amount: 25, sourceType: 'activity', sourceId: 'activity' };
    const screen = render(<DailyExpensesTab
      backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
      groupMembers={groupMembers} expenses={[...expenses, paidActivity]} setExpenses={jest.fn()}
      defaultPayerId="m1" styles={styles} costTrackingAllowed />);
    expect(screen.queryByTestId('other-expenses')).toBeNull();
  });

  it('omits Other Expenses entirely when all of its entries are zero', () => {
    const zeroActivity = { ...expenses[0], id: 'free', category: 'Activities', amount: 0, sourceType: 'activity', sourceId: 'free-activity' };
    const screen = render(<DailyExpensesTab
      backendUrl="http://example.test" theme={theme} headers={{}} jsonHeaders={{}} trip={trip}
      groupMembers={groupMembers} expenses={[zeroActivity]} setExpenses={jest.fn()}
      defaultPayerId="m1" styles={styles} costTrackingAllowed />);
    expect(screen.queryByTestId('other-expenses')).toBeNull();
    expect(screen.queryByTestId('other-expenses-clear-zero')).toBeNull();
  });

  it('saves a description when creating a daily expense', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...expenses[0],
        id: 'e2',
        amount: 18.75,
        vendor: 'Flour Bakery',
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
      fireEvent.changeText(getByPlaceholderText('Description'), 'Flour Bakery');
      expect(() => getByPlaceholderText('Notes')).toThrow();
      fireEvent.press(getByText('Save Expense'));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://example.test/api/expenses',
        expect.objectContaining({
          method: 'POST',
          // New expenses carry a stable Idempotency-Key so a retry (or offline replay) can't duplicate them.
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
            'Idempotency-Key': expect.stringMatching(/^exp_[A-Za-z0-9_-]{8,}$/),
          },
          body: expect.any(String),
        })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual(expect.objectContaining({
        vendor: 'Flour Bakery',
        amount: 18.75,
      }));
      expect(body.notes).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('renders a bounded web date input and keeps a selected expense date', () => {
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    try {
      const screen = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          theme={theme}
          headers={{}}
          jsonHeaders={{}}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={() => {}}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
        />,
      );

      fireEvent.press(screen.getByTestId('expense-add-button'));
      const dateInput = screen.getByTestId('daily-expense-date') as any;
      expect(dateInput.props.type).toBe('date');
      expect(dateInput.props.min).toBe('2025-02-01');
      expect(dateInput.props.max).toBe('2025-02-02');

      fireEvent(dateInput, 'change', { target: { value: '2025-02-02' } });
      expect(screen.getByTestId('daily-expense-date').props.value).toBe('2025-02-02');
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('opens a native date picker outside the scrolling expense form and commits its selection', () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      const screen = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          theme={theme}
          headers={{}}
          jsonHeaders={{}}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={() => {}}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
        />,
      );

      fireEvent.press(screen.getByTestId('expense-add-button'));
      fireEvent.press(screen.getByTestId('daily-expense-date'));

      const picker = screen.getByTestId('native-date-time-picker');
      expect(picker.props.display).toBe('spinner');
      expect(picker.props.minimumDate).toEqual(new Date(2025, 1, 1));
      expect(picker.props.maximumDate).toEqual(new Date(2025, 1, 2));

      act(() => {
        picker.props.onValueChange({ nativeEvent: {} }, new Date(2025, 1, 2));
      });
      fireEvent.press(screen.getByTestId('daily-expense-date-done'));

      expect(screen.getByText('2025-02-02')).toBeTruthy();
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('restores an unsaved open expense dialog after a refresh and only Cancel discards it', () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock as any;

    try {
      const firstLoad = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          theme={theme}
          headers={{}}
          jsonHeaders={{}}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={() => {}}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
        />,
      );

      fireEvent.press(firstLoad.getByTestId('expense-add-button'));
      fireEvent.changeText(firstLoad.getByPlaceholderText('Amount'), '18.75');
      fireEvent.changeText(firstLoad.getByPlaceholderText('Description'), 'Flour Bakery');
      // The dialog overlay has no dismissal action, so a backdrop click leaves
      // the draft and dialog alone.
      fireEvent.press(firstLoad.getByTestId('expense-add-modal'));
      expect(firstLoad.getByPlaceholderText('Amount').props.value).toBe('18.75');
      expect(fetchMock).not.toHaveBeenCalled();

      firstLoad.unmount();

      const refreshed = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          theme={theme}
          headers={{}}
          jsonHeaders={{}}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={() => {}}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
        />,
      );

      expect(refreshed.getByTestId('expense-add-modal')).toBeTruthy();
      expect(refreshed.getByPlaceholderText('Amount').props.value).toBe('18.75');
      expect(refreshed.getByPlaceholderText('Description').props.value).toBe('Flour Bakery');
      expect(refreshed.queryByPlaceholderText('Notes')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.press(refreshed.getByTestId('expense-cancel'));
      expect(refreshed.queryByTestId('expense-add-modal')).toBeNull();

      refreshed.unmount();
      const afterCancelRefresh = render(
        <DailyExpensesTab
          backendUrl="http://example.test"
          theme={theme}
          headers={{}}
          jsonHeaders={{}}
          trip={trip}
          groupMembers={groupMembers}
          expenses={[]}
          setExpenses={() => {}}
          defaultPayerId="m1"
          styles={styles}
          costTrackingAllowed
        />,
      );
      expect(afterCancelRefresh.queryByTestId('expense-add-modal')).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
