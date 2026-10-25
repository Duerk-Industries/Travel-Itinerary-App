import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import CostReportExpenses from '../components/CostReportExpenses';
import { buildAllExpenses } from '../utils/costs';

const members = [{ id: 'm1', firstName: 'Alex', lastName: 'Rider' }];
const build = (cost: number) => buildAllExpenses([], [], [
  { id: 'activity', name: 'Museum tour', cost, date: '2027-05-11', paidBy: ['m1'] },
], [], [
  { id: 'lunch-1', expenseDate: '2027-05-10', category: 'Lunch', amount: 12, vendor: 'First lunch', payerIds: ['m1'], forIds: ['m1'] },
  { id: 'lunch-2', expenseDate: '2027-05-10', category: 'Lunch', amount: 18, vendor: 'Second lunch', payerIds: ['m1'], forIds: ['m1'] },
  { id: 'zero', expenseDate: '2027-05-10', category: 'Other', amount: 0 },
  { id: 'refund', expenseDate: '2027-05-09', category: 'Other', amount: -5 },
  { id: 'mirrored', sourceType: 'activity', sourceId: 'activity', amount: cost },
], 'USD', ['m1']);

it('lists each daily expense and itinerary item once, hides zeros, and retains refunds', () => {
  const onEdit = jest.fn();
  const screen = render(<CostReportExpenses expenses={build(25)} members={members} styles={{}} onEditItineraryItem={onEdit} />);
  expect(screen.getAllByTestId(/^other-expense-row-/)).toHaveLength(4);
  expect(screen.getByText('First lunch')).toBeTruthy();
  expect(screen.getByText('Second lunch')).toBeTruthy();
  expect(screen.queryByTestId('other-expense-row-expense-zero')).toBeNull();
  expect(screen.queryByTestId('other-expense-row-expense-mirrored')).toBeNull();
  expect(within(screen.getByTestId('other-expense-row-expense-refund')).getByText('$-5.00')).toBeTruthy();
  fireEvent.press(screen.getByTestId('other-expense-edit-source-tour-activity'));
  expect(onEdit).toHaveBeenCalledWith('activity', 'activity');
});

it('responds when an item changes between zero and non-zero, and respects read-only access', () => {
  const draw = (cost: number) => <CostReportExpenses expenses={build(cost)} members={members} styles={{}} readOnly onEditItineraryItem={jest.fn()} />;
  const screen = render(draw(0));
  expect(screen.queryByTestId('other-expense-row-tour-activity')).toBeNull();
  screen.rerender(draw(25));
  expect(screen.getByText('Museum tour')).toBeTruthy();
  expect(screen.queryByTestId('other-expense-edit-source-tour-activity')).toBeNull();
  screen.rerender(draw(0));
  expect(screen.queryByTestId('other-expense-row-tour-activity')).toBeNull();
});
