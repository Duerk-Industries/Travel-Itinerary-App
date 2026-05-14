/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AddItemPopover, { type AddItemKind } from '../components/AddItemPopover';

describe('AddItemPopover', () => {
  it('renders four options when visible', () => {
    const { getByTestId, getByText, queryByText } = render(
      <AddItemPopover visible onSelect={() => {}} onClose={() => {}} />
    );
    expect(getByTestId('add-item-popover')).toBeTruthy();
    expect(getByTestId('add-item-option-place')).toBeTruthy();
    expect(getByTestId('add-item-option-note')).toBeTruthy();
    expect(getByTestId('add-item-option-checklist')).toBeTruthy();
    expect(getByTestId('add-item-option-activity')).toBeTruthy();
    expect(getByText('Time + activity + cost')).toBeTruthy();
    expect(queryByText(/legacy form/i)).toBeNull();
  });

  it('fires onSelect with the chosen kind', () => {
    const onSelect = jest.fn<void, [AddItemKind]>();
    const { getByTestId } = render(
      <AddItemPopover visible onSelect={onSelect} onClose={() => {}} />
    );
    fireEvent.press(getByTestId('add-item-option-place'));
    expect(onSelect).toHaveBeenCalledWith('place');
    fireEvent.press(getByTestId('add-item-option-note'));
    expect(onSelect).toHaveBeenCalledWith('note');
    fireEvent.press(getByTestId('add-item-option-checklist'));
    expect(onSelect).toHaveBeenCalledWith('checklist');
    fireEvent.press(getByTestId('add-item-option-activity'));
    expect(onSelect).toHaveBeenCalledWith('activity');
  });

  it('fires onClose when the cancel button is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <AddItemPopover visible onSelect={() => {}} onClose={onClose} />
    );
    fireEvent.press(getByTestId('add-item-option-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
