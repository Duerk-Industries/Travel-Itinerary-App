/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ConfirmDialog from '../components/ConfirmDialog';
import ChatButton from '../components/ChatButton';

const styles: Record<string, any> = {
  modalOverlay: {},
  confirmModal: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  button: {},
  dangerButton: {},
  dangerButtonText: {},
  buttonText: {},
};

describe('ConfirmDialog accessibility', () => {
  it('exposes an alert role and labels from title/message', () => {
    const { getByTestId } = render(
      <ConfirmDialog
        visible
        title="Delete this trip?"
        message="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
        styles={styles}
      />
    );
    const overlay = getByTestId('confirm-dialog');
    expect(overlay.props.accessibilityRole).toBe('alert');
    expect(overlay.props.accessibilityLabel).toBe('Delete this trip?');
    expect(overlay.props.accessibilityHint).toBe('This cannot be undone.');
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
  });

  it('labels the primary action and cancel button with their visible text', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByLabelText } = render(
      <ConfirmDialog
        visible
        title="Delete?"
        confirmLabel="Yes, delete"
        cancelLabel="Keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
        styles={styles}
      />
    );
    const confirmBtn = getByLabelText('Yes, delete');
    const cancelBtn = getByLabelText('Keep');
    expect(confirmBtn.props.accessibilityRole).toBe('button');
    expect(cancelBtn.props.accessibilityRole).toBe('button');
    fireEvent.press(confirmBtn);
    fireEvent.press(cancelBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <ConfirmDialog
        visible={false}
        title="x"
        onConfirm={() => {}}
        onCancel={() => {}}
        styles={styles}
      />
    );
    expect(queryByTestId('confirm-dialog')).toBeNull();
  });

  it('closes on Escape keypress when visible on web', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        visible
        title="Escape me"
        onConfirm={() => {}}
        onCancel={onCancel}
        styles={styles}
      />
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel on Escape when the dialog is not visible', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        visible={false}
        title="Hidden"
        onConfirm={() => {}}
        onCancel={onCancel}
        styles={styles}
      />
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onCancel = jest.fn();
    const { unmount } = render(
      <ConfirmDialog
        visible
        title="Gone"
        onConfirm={() => {}}
        onCancel={onCancel}
        styles={styles}
      />
    );
    unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('ChatButton accessibility', () => {
  it('labels the FAB with its purpose and includes unread count in the label', () => {
    const { getByTestId, rerender } = render(<ChatButton onPress={() => {}} unreadCount={0} />);
    const fab = getByTestId('chat-fab');
    expect(fab.props.accessibilityRole).toBe('button');
    expect(fab.props.accessibilityLabel).toBe('Open trip chat');

    rerender(<ChatButton onPress={() => {}} unreadCount={3} />);
    expect(getByTestId('chat-fab').props.accessibilityLabel).toBe('Open trip chat, 3 unread');

    rerender(<ChatButton onPress={() => {}} unreadCount={250} />);
    expect(getByTestId('chat-fab').props.accessibilityLabel).toBe('Open trip chat, over 99 unread');
  });
});
