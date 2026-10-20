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
