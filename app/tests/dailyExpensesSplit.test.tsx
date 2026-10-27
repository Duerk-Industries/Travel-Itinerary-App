/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import DailyExpensesTab from '../tabs/dailyExpenses';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('auto', null);
const styles: Record<string, any> = new Proxy({}, { get: () => ({}) });

const trip = { id: 't1', groupId: 'g1', name: 'Test Trip', startDate: '2025-02-01', endDate: '2025-02-02', currency: 'USD' };
const groupMembers = [
  { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
  { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
  { id: 'm3', firstName: 'Casey', lastName: 'Fox', status: 'active' as const },
];

const renderTab = (extra: Record<string, unknown> = {}) =>
  render(
    <DailyExpensesTab backendUrl="http://api" theme={theme} headers={{}} jsonHeaders={{}} trip={trip as any} groupMembers={groupMembers}
      expenses={[]} setExpenses={() => {}} defaultPayerId="m1" styles={styles} costTrackingAllowed {...extra} />
  );

describe('Daily expense form: who it is for', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { (global as any).fetch = undefined; });

  it('starts with everyone, narrows to the travelers tapped after "Only these travelers", and goes back to everyone', () => {
    const screen = renderTab();
    fireEvent.press(screen.getByTestId('expense-add-button'));
    expect(screen.queryByTestId('expense-for-hint')).toBeNull();

    fireEvent.press(screen.getByTestId('expense-for-only'));
    expect(screen.getByTestId('expense-for-hint').props.children).toBe('Tap the travelers who share this expense.');
    fireEvent.press(screen.getByTestId('expense-for-m1'));
    fireEvent.press(screen.getByTestId('expense-for-m3'));
    expect(screen.getByTestId('expense-for-hint').props.children).toBe('Shared by 2 of 3 travelers.');

    fireEvent.press(screen.getByTestId('expense-for-everyone'));
    expect(screen.queryByTestId('expense-for-hint')).toBeNull();
  });

  it('offers an uneven split only when two or more travelers share it, with a live amount per person', () => {
    const screen = renderTab();
    fireEvent.press(screen.getByTestId('expense-add-button'));
    fireEvent.press(screen.getByTestId('expense-for-only'));
    fireEvent.press(screen.getByTestId('expense-for-m1'));
    expect(screen.queryByTestId('expense-split-uneven')).toBeNull();
    fireEvent.press(screen.getByTestId('expense-for-m2'));
    fireEvent.changeText(screen.getByPlaceholderText('Amount'), '60');

    fireEvent.press(screen.getByTestId('expense-split-uneven'));
    expect(screen.getByTestId('expense-share-amount-m1').props.children).toBe('30.00');
    fireEvent.press(screen.getByTestId('expense-share-inc-m2'));
    expect(screen.getByTestId('expense-share-weight-m2').props.children).toBe(2);
    expect(screen.getByTestId('expense-share-amount-m1').props.children).toBe('20.00');
    expect(screen.getByTestId('expense-share-amount-m2').props.children).toBe('40.00');

    // The weight cannot drop below one share.
    fireEvent.press(screen.getByTestId('expense-share-dec-m1'));
    expect(screen.getByTestId('expense-share-weight-m1').props.children).toBe(1);

    fireEvent.press(screen.getByTestId('expense-split-uneven'));
    expect(screen.queryByTestId('expense-shares')).toBeNull();
  });

  it('saves the weights with the expense, and sends none for an equal split', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ id: `new-${calls.length}`, ...JSON.parse(String(init?.body ?? '{}')), createdAt: '2025-02-01T00:00:00Z' }) } as any;
    });
    const screen = renderTab();

    fireEvent.press(screen.getByTestId('expense-add-button'));
    fireEvent.press(screen.getByTestId('expense-for-only'));
    fireEvent.press(screen.getByTestId('expense-for-m1'));
    fireEvent.press(screen.getByTestId('expense-for-m2'));
    fireEvent.changeText(screen.getByPlaceholderText('Amount'), '60');
    fireEvent.press(screen.getByTestId('expense-split-uneven'));
    fireEvent.press(screen.getByTestId('expense-share-inc-m2'));
    fireEvent.press(screen.getByTestId('expense-save'));
    await waitFor(() => expect(calls.some((call) => call.init?.method === 'POST')).toBe(true));
    const post = calls.find((call) => call.init?.method === 'POST');
    expect(JSON.parse(post.init.body)).toMatchObject({ forIds: ['m1', 'm2'], forShares: { m1: 1, m2: 2 }, amount: 60 });

    // Split unevenly but leave every weight at one: that is just an equal split.
    await waitFor(() => expect(screen.queryByTestId('expense-add-modal')).toBeNull());
    calls.length = 0;
    fireEvent.press(screen.getByTestId('expense-add-button'));
    fireEvent.changeText(screen.getByPlaceholderText('Amount'), '10');
    fireEvent.press(screen.getByTestId('expense-split-uneven'));
    fireEvent.press(screen.getByTestId('expense-save'));
    await waitFor(() => expect(calls.some((call) => call.init?.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((call) => call.init?.method === 'POST').init.body).forShares).toBeUndefined();
  });

  it('starts a new expense in the category used last', async () => {
    window.localStorage.setItem('stp.daily-expense-last-category', JSON.stringify('Souvenirs'));
    const screen = renderTab();
    fireEvent.press(screen.getByTestId('expense-add-button'));
    expect(screen.getAllByText('Souvenirs').length).toBeGreaterThan(0);
  });
});
