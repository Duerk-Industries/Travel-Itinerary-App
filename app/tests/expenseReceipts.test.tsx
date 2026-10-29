/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ExpenseReceiptPanel from '../components/ExpenseReceiptPanel';
import DailyExpensesTab from '../tabs/dailyExpenses';
import { getAppTheme } from '../theme/theme';

const styles: Record<string, any> = new Proxy({}, { get: () => ({}) });
const jsonResponse = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

describe('ExpenseReceiptPanel', () => {
  afterEach(() => { (global as any).fetch = undefined; });

  const renderPanel = (props: Partial<React.ComponentProps<typeof ExpenseReceiptPanel>> = {}) =>
    render(
      <ExpenseReceiptPanel backendUrl="http://api" headers={{ Authorization: 'Bearer t' }} expenseId="e 1" title="Cafe Nero" hasReceipt canEdit
        onChanged={jest.fn()} onClose={jest.fn()} styles={styles} {...props} />
    );

  it('loads the signed image URL for an expense that has a receipt', async () => {
    const fetchMock = jest.fn().mockImplementation(() => jsonResponse({ url: 'https://storage.test/r.png', contentType: 'image/png' }));
    (global as any).fetch = fetchMock;
    const { findByTestId } = renderPanel();
    expect(await findByTestId('expense-receipt-open')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/expenses/e%201/receipt', { headers: { Authorization: 'Bearer t' } });
  });

  it('does not fetch when there is no receipt, and says so', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    const { findByText } = renderPanel({ hasReceipt: false });
    expect(await findByText('No receipt stored for this expense.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes the receipt and reports the change', async () => {
    const onChanged = jest.fn();
    const fetchMock = jest.fn().mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error('empty')) }) : jsonResponse({ url: 'https://storage.test/r.png' }));
    (global as any).fetch = fetchMock;
    const { findByTestId } = renderPanel({ onChanged });
    fireEvent.press(await findByTestId('expense-receipt-remove'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/expenses/e%201/receipt', { method: 'DELETE', headers: { Authorization: 'Bearer t' } });
  });

  it('shows a read-only viewer no attach or remove controls', async () => {
    (global as any).fetch = jest.fn().mockImplementation(() => jsonResponse({ url: 'https://storage.test/r.png' }));
    const { findByTestId, queryByTestId } = renderPanel({ canEdit: false });
    await findByTestId('expense-receipt-open');
    expect(queryByTestId('expense-receipt-remove')).toBeNull();
    expect(queryByTestId('expense-receipt-attach')).toBeNull();
  });
});

describe('DailyExpensesTab receipts', () => {
  const trip = { id: 't1', groupId: 'g1', name: 'Test Trip', startDate: '2025-02-01', endDate: '2025-02-02', currency: 'EUR' };
  const groupMembers = [{ id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const }];
  const expense = (id: string, vendor: string) => ({
    id, tripId: 't1', groupId: 'g1', userId: 'u1', expenseDate: '2025-02-01', category: 'Breakfast', amount: 12, currency: 'EUR',
    vendor, notes: null, payerIds: ['m1'], forIds: ['m1'], createdAt: '2025-02-01T10:00:00Z',
  });

  afterEach(() => { (global as any).fetch = undefined; });

  it("marks expenses that have a stored receipt, and opens the receipt from the day's details", async () => {
    const fetchMock = jest.fn().mockImplementation((url: string) =>
      String(url).includes('/receipts?tripId=') ? jsonResponse({ expenseIds: ['e1'] }) : jsonResponse({ url: 'https://storage.test/r.png' }));
    (global as any).fetch = fetchMock;
    const { getAllByText, findByTestId, getByTestId } = render(
      <DailyExpensesTab backendUrl="http://api" theme={getAppTheme('auto', null)} headers={{}} jsonHeaders={{}} trip={trip as any} groupMembers={groupMembers}
        expenses={[expense('e1', 'Cafe Nero'), expense('e2', 'Bakery')] as any} setExpenses={() => {}} defaultPayerId="m1" styles={styles} costTrackingAllowed readOnly />
    );
    fireEvent.press(getAllByText('$24.00')[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://api/api/expenses/receipts?tripId=t1', { headers: {} }));
    expect(await findByTestId('expense-receipt-e1')).toBeTruthy();
    expect(() => getByTestId('expense-receipt-e2')).toThrow(); // read-only viewers cannot attach one
    fireEvent.press(getByTestId('expense-receipt-e1'));
    expect(await findByTestId('expense-receipt-open')).toBeTruthy();
  });
});
