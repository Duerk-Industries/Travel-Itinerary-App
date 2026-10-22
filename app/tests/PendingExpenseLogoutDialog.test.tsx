import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PendingExpenseLogoutDialog from '../components/PendingExpenseLogoutDialog';

it('shows the unsynced count and requires a deliberate recovery choice', () => {
  const onCancel = jest.fn(), onSync = jest.fn(), onKeep = jest.fn(), onDiscard = jest.fn();
  const screen = render(<PendingExpenseLogoutDialog visible count={3} {...{ onCancel, onSync, onKeep, onDiscard }} />);
  expect(screen.getByText('3 unsynced expenses')).toBeTruthy();
  expect(onDiscard).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Sync now and stay signed in'));
  expect(onSync).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Keep on this device and sign out'));
  expect(onKeep).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Discard expenses and sign out'));
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it('warns about unreadable retained work even when its count is unknown', () => {
  const screen = render(<PendingExpenseLogoutDialog visible count={0} error="The device encryption key is unavailable."
    onCancel={jest.fn()} onSync={jest.fn()} onKeep={jest.fn()} onDiscard={jest.fn()} />);
  expect(screen.getByText('Saved expenses need recovery')).toBeTruthy();
  expect(screen.getByText('The device encryption key is unavailable.')).toBeTruthy();
});
