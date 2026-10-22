/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PendingExpenseRecovery from '../components/PendingExpenseRecovery';
import { exportCsv } from '../utils/csvExport';

jest.mock('../utils/csvExport', () => ({ exportCsv: jest.fn(async () => 'downloaded') }));

const ownerId = 'owner-a';
const environment = 'https://api.test';
const file = (raw: string, over: Record<string, unknown> = {}) => {
  const envelope = JSON.stringify({ schemaVersion: 1, kind: 'pending-expense-recovery', ownerId, environment, raw, ...over });
  return `Saved expense queue recovery\n"${envelope.replace(/"/g, '""')}"`;
};

const mount = (repairQueue: jest.Mock) =>
  render(<PendingExpenseRecovery error="Saved expenses could not be read" ownerId={ownerId} environment={environment} getRecoveryData={async () => '{broken'} repairQueue={repairQueue} />);

describe('expense queue repair flow', () => {
  beforeEach(() => jest.mocked(exportCsv).mockResolvedValue('downloaded'));

  it('only offers Repair after a recovery copy has been exported', async () => {
    const repair = jest.fn(async () => ({ status: 'repaired' as const, restored: 2, skipped: 1, alreadyHandled: 0, backupKey: 'b' }));
    const screen = mount(repair);
    expect(screen.getByTestId('expense-recovery-repair').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('expense-recovery-repair'));
    expect(repair).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('expense-recovery-export'));
    await waitFor(() => expect(screen.getByTestId('expense-recovery-repair').props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId('expense-recovery-repair'));
    await waitFor(() => expect(repair).toHaveBeenCalledWith([]));
    const result = await screen.findByTestId('expense-recovery-result');
    expect(result.props.children).toMatch(/Recovered 2 expenses/);
    expect(result.props.children).toMatch(/1 entry could not be read; they remain in the backup/);
  });

  it('stays unlocked-out when the export fails', async () => {
    jest.mocked(exportCsv).mockResolvedValue('failed' as never);
    const screen = mount(jest.fn());
    fireEvent.press(screen.getByTestId('expense-recovery-export'));
    await screen.findByText('Could not export. The original is still kept; try again.');
    expect(screen.getByTestId('expense-recovery-repair').props.accessibilityState.disabled).toBe(true);
  });

  it('restores from pasted file contents of the same account and server', async () => {
    const repair = jest.fn(async () => ({ status: 'repaired' as const, restored: 1, skipped: 0, alreadyHandled: 1, backupKey: 'b' }));
    const screen = mount(repair);
    fireEvent.changeText(screen.getByTestId('expense-recovery-paste'), file('[{"id":"a"}]'));
    fireEvent.press(screen.getByTestId('expense-recovery-restore'));
    await waitFor(() => expect(repair).toHaveBeenCalledWith(['[{"id":"a"}]']));
    const result = await screen.findByTestId('expense-recovery-result');
    expect(result.props.children).toMatch(/1 was already synced or discarded and was not added again/);
  });

  it.each([
    [{ ownerId: 'someone-else' }, /different account/],
    [{ environment: 'https://other.test' }, /different server/],
  ])('refuses a file that does not belong here (%o)', async (over, message) => {
    const repair = jest.fn();
    const screen = mount(repair);
    fireEvent.changeText(screen.getByTestId('expense-recovery-paste'), file('[]', over));
    fireEvent.press(screen.getByTestId('expense-recovery-restore'));
    await screen.findByText(message);
    expect(repair).not.toHaveBeenCalled();
  });

  it('says plainly when nothing could be recovered, and when the repair did not complete', async () => {
    const repair = jest.fn()
      .mockResolvedValueOnce({ status: 'nothing-recoverable' as const, skipped: 3 })
      .mockResolvedValueOnce({ status: 'failed' as const });
    const screen = mount(repair);
    fireEvent.changeText(screen.getByTestId('expense-recovery-paste'), file('[]'));
    fireEvent.press(screen.getByTestId('expense-recovery-restore'));
    expect((await screen.findByTestId('expense-recovery-result')).props.children).toMatch(/No expenses could be recovered \(3 entries were unreadable\)\. Nothing was changed/);
    fireEvent.changeText(screen.getByTestId('expense-recovery-paste'), file('[]'));
    fireEvent.press(screen.getByTestId('expense-recovery-restore'));
    await waitFor(() => expect(screen.getByTestId('expense-recovery-result').props.children).toMatch(/did not complete, so nothing was changed/));
  });

  it('keeps showing the outcome after the error clears, and shows nothing when healthy', async () => {
    const view = render(<PendingExpenseRecovery error={null} ownerId={ownerId} environment={environment} getRecoveryData={async () => null} />);
    expect(view.toJSON()).toBeNull();
    const repair = jest.fn(async () => ({ status: 'repaired' as const, restored: 1, skipped: 0, alreadyHandled: 0, backupKey: 'b' }));
    const screen = mount(repair);
    fireEvent.changeText(screen.getByTestId('expense-recovery-paste'), file('[]'));
    fireEvent.press(screen.getByTestId('expense-recovery-restore'));
    await screen.findByTestId('expense-recovery-result');
    screen.rerender(<PendingExpenseRecovery error={null} ownerId={ownerId} environment={environment} getRecoveryData={async () => null} repairQueue={repair} />);
    expect(screen.getByTestId('expense-recovery-result').props.children).toMatch(/Recovered 1 expense\./);
  });
});
