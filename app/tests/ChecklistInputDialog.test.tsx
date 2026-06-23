/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ChecklistInputDialog from '../components/ChecklistInputDialog';

describe('ChecklistInputDialog', () => {
  it('does not submit until both title and at least one labeled item are provided', () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId, queryByText } = render(
      <ChecklistInputDialog visible onSubmit={onSubmit} onCancel={onCancel} />
    );
    fireEvent.press(getByTestId('checklist-dialog-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryByText(/Title is required/i)).toBeTruthy();

    fireEvent.changeText(getByTestId('checklist-dialog-title'), 'Packing list');
    fireEvent.press(getByTestId('checklist-dialog-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryByText(/Add at least one checklist item/i)).toBeTruthy();
  });

  it('submits the cleaned title + day + items, dropping empty rows', () => {
    const onSubmit = jest.fn();
    const { getByTestId } = render(
      <ChecklistInputDialog visible defaultDay={3} onSubmit={onSubmit} onCancel={() => {}} />
    );
    fireEvent.changeText(getByTestId('checklist-dialog-title'), 'Packing list');
    fireEvent.changeText(getByTestId('checklist-dialog-item-0'), 'Passport');
    // Item 1 left empty on purpose — it should be dropped.
    fireEvent.press(getByTestId('checklist-dialog-add-item'));
    fireEvent.changeText(getByTestId('checklist-dialog-item-2'), 'Medicine');

    fireEvent.press(getByTestId('checklist-dialog-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      day: 3,
      title: 'Packing list',
      items: [{ label: 'Passport' }, { label: 'Medicine' }],
    });
  });

  it('removes a child row when the remove button is pressed', () => {
    const onSubmit = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <ChecklistInputDialog visible onSubmit={onSubmit} onCancel={() => {}} />
    );
    fireEvent.changeText(getByTestId('checklist-dialog-title'), 'X');
    fireEvent.changeText(getByTestId('checklist-dialog-item-0'), 'A');
    fireEvent.changeText(getByTestId('checklist-dialog-item-1'), 'B');
    fireEvent.press(getByTestId('checklist-dialog-remove-1'));
    expect(queryByTestId('checklist-dialog-item-1')).toBeNull();
  });
});
