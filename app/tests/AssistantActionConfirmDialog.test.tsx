/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AssistantActionConfirmDialog from '../components/AssistantActionConfirmDialog';
import type { Tour } from '../tabs/activities';
import type { PendingAction } from '../hooks/useAssistantChat';

const makeTour = (overrides: Partial<Tour> = {}): Tour => ({
  id: 'tour-1',
  status: 'Needed',
  activityType: 'Tour',
  date: '2026-09-02',
  name: 'Museum Tour',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: '',
  bookedOn: '',
  reference: '',
  notes: '',
  paidBy: [],
  travelerIds: [],
  ...overrides,
});

const ADD_ACTIVITY: PendingAction = {
  kind: 'addActivity',
  args: { name: 'Louvre tour', date: '2026-04-12', startLocation: 'Louvre', startTime: '10:00' },
};

const UPDATE_STATUS: PendingAction = {
  kind: 'updateItineraryStatus',
  args: { itemName: 'Eiffel Tower tour', status: 'Booked' },
};

describe('AssistantActionConfirmDialog', () => {
  it('renders nothing when there is no pending action', () => {
    const { queryByTestId } = render(
      <AssistantActionConfirmDialog
        visible={false}
        pendingAction={null}
        activities={[]}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(queryByTestId('assistant-action-confirm-dialog')).toBeNull();
  });

  it('addActivity mode: shows a plain-language summary and confirms immediately (no picker needed)', () => {
    const onConfirm = jest.fn();
    const { getByTestId, getByText } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={ADD_ACTIVITY}
        activities={[]}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    expect(getByText(/Louvre tour/)).toBeTruthy();
    expect(getByTestId('assistant-action-confirm').props.disabled).toBeFalsy();
    fireEvent.press(getByTestId('assistant-action-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('addActivity mode: onCancel fires without calling onConfirm', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={ADD_ACTIVITY}
        activities={[]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.press(getByTestId('assistant-action-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both Confirm and Cancel, and shows a busy label, while confirming is true', () => {
    // Regression test: manual testing found repeated taps on Confirm (no
    // visual feedback while the dispatch's fetch was in flight) creating
    // several duplicate activities -- one dispatch per tap. The hook-level
    // ref guard (useAssistantChat.test.tsx) is what actually prevents the
    // duplicate call; this covers the other half of the fix, that the UI
    // itself stops accepting taps and tells the user something is happening.
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId, getByText } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={ADD_ACTIVITY}
        activities={[]}
        confirming
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(getByTestId('assistant-action-confirm').props.disabled).toBe(true);
    expect(getByTestId('assistant-action-cancel').props.disabled).toBe(true);
    expect(getByText(/Confirming/)).toBeTruthy();

    fireEvent.press(getByTestId('assistant-action-confirm'));
    fireEvent.press(getByTestId('assistant-action-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('updateItineraryStatus mode: Confirm starts disabled until a picker row is selected', () => {
    const onConfirm = jest.fn();
    const activities = [makeTour({ id: 'a', name: 'Eiffel Tower tour' }), makeTour({ id: 'b', name: 'Harbor cruise' })];
    const { getByTestId } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={UPDATE_STATUS}
        activities={activities}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    expect(getByTestId('assistant-action-confirm').props.disabled).toBe(true);

    fireEvent.press(getByTestId('assistant-action-picker-row-a'));
    expect(getByTestId('assistant-action-confirm').props.disabled).toBeFalsy();

    fireEvent.press(getByTestId('assistant-action-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('a');
  });

  it('updateItineraryStatus mode: ranks the picker with the best name match first', () => {
    const activities = [
      makeTour({ id: 'unrelated', name: 'Harbor cruise' }),
      makeTour({ id: 'match', name: 'Eiffel Tower tour' }),
    ];
    const { getAllByTestId } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={UPDATE_STATUS}
        activities={activities}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    const rows = getAllByTestId(/assistant-action-picker-row-/);
    expect(rows[0].props.testID).toBe('assistant-action-picker-row-match');
  });

  it('resets the picker selection when a new pending action comes in', () => {
    const onConfirm = jest.fn();
    const activities = [makeTour({ id: 'a', name: 'Eiffel Tower tour' })];
    const { getByTestId, rerender } = render(
      <AssistantActionConfirmDialog
        visible
        pendingAction={UPDATE_STATUS}
        activities={activities}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('assistant-action-picker-row-a'));
    expect(getByTestId('assistant-action-confirm').props.disabled).toBeFalsy();

    rerender(
      <AssistantActionConfirmDialog
        visible
        pendingAction={{ kind: 'updateItineraryStatus', args: { itemName: 'Harbor cruise', status: 'Cancelled' } }}
        activities={activities}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    expect(getByTestId('assistant-action-confirm').props.disabled).toBe(true);
  });
});
