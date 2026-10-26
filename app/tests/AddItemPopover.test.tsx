/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AddItemPopover from '../components/AddItemPopover';

describe('AddItemPopover', () => {
  it('offers only notes and checklists from Add item', () => {
    const onSelect = jest.fn();
    const screen = render(<AddItemPopover visible onSelect={onSelect} onClose={() => {}} />);
    expect(screen.getAllByTestId(/^add-item-option-/).map((row) => row.props.testID)).toEqual([
      'add-item-option-note', 'add-item-option-checklist', 'add-item-option-cancel',
    ]);
    fireEvent.press(screen.getByTestId('add-item-option-note'));
    expect(onSelect).toHaveBeenCalledWith('note');
    fireEvent.press(screen.getByTestId('add-item-option-checklist'));
    expect(onSelect).toHaveBeenCalledWith('checklist');
  });

  it('offers saved optional activities before Add a new activity', () => {
    const onSelect = jest.fn();
    const onSchedule = jest.fn();
    const screen = render(<AddItemPopover visible mode="activities" onSelect={onSelect} onClose={() => {}}
      optionalActivities={[{ id: 'option-1', name: 'Nearby museum' }]} onSelectOptionalActivity={onSchedule} />);
    const order = screen.getAllByTestId(/^add-item-(?:optional-|option-)/).map((row) => row.props.testID);
    expect(order).toEqual(['add-item-optional-option-1', 'add-item-option-activity', 'add-item-option-cancel']);
    expect(screen.getByText('Add a new activity')).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-item-optional-option-1'));
    expect(onSchedule).toHaveBeenCalledWith('option-1');
    fireEvent.press(screen.getByTestId('add-item-option-activity'));
    expect(onSelect).toHaveBeenCalledWith('activity');
    expect(screen.queryByText('Add a place')).toBeNull();
    expect(screen.queryByText('Add an optional activity')).toBeNull();
  });

  it('still offers a new activity when no saved options exist', () => {
    const screen = render(<AddItemPopover visible mode="activities" onSelect={() => {}} onClose={() => {}} hiddenKinds={['note', 'checklist']} />);
    expect(screen.getByTestId('add-item-option-activity')).toBeTruthy();
    expect(screen.queryByText('Optional activities for this day')).toBeNull();
  });

  it('closes on Cancel', () => {
    const onClose = jest.fn();
    const screen = render(<AddItemPopover visible onSelect={() => {}} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('add-item-option-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
