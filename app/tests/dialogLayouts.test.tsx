/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import DialogShell from '../components/DialogShell';
import ConfirmDialog from '../components/ConfirmDialog';
import PaymentDialog from '../components/PaymentDialog';

const styles: Record<string, any> = {
  modalOverlay: { name: 'overlay' },
  confirmModal: { name: 'confirm-card' },
  modalCard: { name: 'modal-card' },
  expenseModalCard: { name: 'expense-card' },
  sectionTitle: {},
  helperText: {},
  row: {},
  input: {},
  button: {},
  dangerButton: {},
  dangerButtonText: {},
  smallButton: {},
  buttonText: {},
  headerText: {},
  expenseToggleButton: {},
  expenseToggleSelected: {},
  expenseToggleUnselected: {},
  expenseToggleText: {},
  expenseToggleTextSelected: {},
  errorText: {},
};

describe('shared dialog layouts', () => {
  it('renders the shared shell overlay, title, message, and card content', () => {
    const { getByTestId, getByText, queryByTestId, rerender } = render(
      <DialogShell visible title="Layout Check" message="Keep the shell consistent." styles={styles} onClose={() => {}} testID="layout-shell">
        <Text>Dialog body</Text>
      </DialogShell>
    );

    const overlay = getByTestId('layout-shell');
    expect(overlay.props.style).toEqual([styles.modalOverlay, undefined]);
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    expect(overlay.props.accessibilityLabel).toBe('Layout Check');
    expect(getByText('Layout Check')).toBeTruthy();
    expect(getByText('Keep the shell consistent.')).toBeTruthy();
    expect(getByText('Dialog body')).toBeTruthy();

    rerender(
      <DialogShell visible={false} title="Layout Check" styles={styles} onClose={() => {}} testID="layout-shell">
        <Text>Dialog body</Text>
      </DialogShell>
    );
    expect(queryByTestId('layout-shell')).toBeNull();
  });

  it('keeps confirmation actions inside the shared modal layout', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId, getByText } = render(
      <ConfirmDialog
        visible
        title="Leave wizard?"
        message="Unsaved changes will be lost."
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={onConfirm}
        onCancel={onCancel}
        styles={styles}
        testID="leave-confirm"
      />
    );

    const overlay = getByTestId('leave-confirm');
    expect(overlay.props.accessibilityRole).toBe('alert');
    expect(within(overlay).getByText('Unsaved changes will be lost.')).toBeTruthy();

    fireEvent.press(getByText('Stay'));
    fireEvent.press(getByText('Leave'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the dialog layout for payment validation and commits draft fields on blur', () => {
    const onSave = jest.fn();
    const { getByLabelText, getByPlaceholderText, getByTestId } = render(
      <PaymentDialog
        visible
        onCancel={() => {}}
        onSave={onSave}
        participants={[]}
        sortedIds={['alice', 'bob']}
        participantLabel={(id) => (id === 'alice' ? 'Alice' : 'Bob')}
        defaultPayerId="alice"
        styles={styles}
      />
    );

    const overlay = getByTestId('payment-dialog');
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    expect(within(overlay).getByText('Record Payment')).toBeTruthy();

    const amountInput = getByPlaceholderText('0.00');
    fireEvent.changeText(amountInput, '12.34');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent(amountInput, 'blur');
    fireEvent.press(getByLabelText('Save payment'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ payerId: 'alice', receiverId: 'bob', amount: 12.34 }));
  });

  it('honors custom shell card styles without wrapping content in an extra card contract', () => {
    const { UNSAFE_getAllByType } = render(
      <DialogShell
        visible
        title="Custom Card"
        styles={styles}
        onClose={() => {}}
        cardStyle={[styles.modalCard, styles.expenseModalCard]}
        testID="custom-card-shell"
      >
        <Text>Body</Text>
      </DialogShell>
    );

    const card = UNSAFE_getAllByType(View).find((view) => {
      const style = view.props.style;
      return Array.isArray(style) && style[0] === styles.confirmModal;
    });

    expect(card?.props.style).toEqual([styles.confirmModal, [styles.modalCard, styles.expenseModalCard]]);
  });
});
