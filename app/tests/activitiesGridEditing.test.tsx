/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React, { useState } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ActivityTab, type Tour } from '../tabs/activities';

jest.mock('react-native', () => {
  return {
    Platform: { OS: 'ios' },
    ScrollView: 'ScrollView',
    Text: 'Text',
    TextInput: 'TextInput',
    Pressable: 'Pressable',
    TouchableOpacity: 'TouchableOpacity',
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    TouchableHighlight: 'TouchableHighlight',
    View: 'View',
    Image: 'Image',
    ImageBackground: 'ImageBackground',
    FlatList: 'FlatList',
    SectionList: 'SectionList',
    Switch: 'Switch',
    Modal: 'Modal',
    SafeAreaView: 'SafeAreaView',
    ActivityIndicator: 'ActivityIndicator',
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => {} }),
    },
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  };
});

// The bulk-save assertions below wait on a real async chain (mocked fetch -> json ->
// several React state updates); the default testing-library waitFor budget is too
// tight for that on a loaded machine, so use a longer timeout / finer poll interval.
const ASYNC_WAIT_OPTIONS = { timeout: 3000, interval: 20 };

const styles = {
  card: {},
  sectionHeaderRow: {},
  sectionTitle: {},
  row: {},
  button: {},
  roundButton: {},
  buttonText: {},
  smallButton: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  headerText: {},
  cellText: {},
  actionCell: {},
  dangerButton: {},
  dangerButtonText: {},
  flightTitle: {},
  helperText: {},
  modalOverlay: {},
  passengerOverlayBackdrop: {},
  modalCard: {},
  modalLabel: {},
  modalRow: {},
  input: {},
  payerChips: {},
  toggleOption: {},
  toggleOptionSelected: {},
  toggleOptionText: {},
  toggleOptionTextSelected: {},
  tableFooter: {},
  linkText: {},
};

const members = [
  { id: 'member-1', firstName: 'Bryan', lastName: 'Duerk', email: 'bryan@example.com', status: 'active' as const },
];

const tourOne: Tour = {
  id: 'tour-1',
  status: 'Completed',
  activityType: 'Tour',
  date: '2026-09-02',
  name: 'Museum Tour',
  startLocation: 'Old Town',
  startTime: '10:00',
  duration: '2h',
  cost: '40',
  freeCancelBy: '2026-08-25',
  bookedOn: 'Viator',
  reference: 'TOUR1',
  notes: 'Bring comfortable walking shoes.',
  paidBy: ['member-1'],
  travelerIds: ['member-1'],
};

const tourTwo: Tour = {
  ...tourOne,
  id: 'tour-2',
  name: 'Harbor Cruise',
};

const renderActivityHarness = (initialTours: Tour[], extraProps: Record<string, unknown> = {}) => {
  const Harness = () => {
    const [tours, setTours] = useState<Tour[]>(initialTours);
    return (
      <ActivityTab
        backendUrl="https://wanderbunnies.test"
        userToken="token"
        activeTripId="trip-1"
        tours={tours}
        setTours={setTours}
        defaultPayerId="member-1"
        payerName={(id) => (id === 'member-1' ? 'Bryan Duerk' : id)}
        formatMemberName={(member) => `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}
        groupMembers={members}
        jsonHeaders={{ Authorization: 'Bearer token' }}
        payerTotals={{}}
        toursTotal={0}
        styles={styles as any}
        nativeDateTimePicker={null}
        fetchTours={jest.fn()}
        onDataChanged={jest.fn()}
        mode="live"
        featureGridEditing
        featureGridEditingClipboard
        {...extraProps}
      />
    );
  };

  return render(<Harness />);
};

describe('Activities grid editing', () => {
  it('opens the edit form when a non-name activity cell is tapped', () => {
    const view = renderActivityHarness([tourOne]);

    fireEvent.press(view.getByTestId('activity-row-tour-1'));
    expect(view.getByTestId('activity-form-modal')).toBeTruthy();
  });

  it('does not open the edit form on row tap when featureTapToEditTables is disabled', () => {
    // Kill-switch coverage for implementation-plan-ux-remediation.md Initiative A.
    const view = renderActivityHarness([tourOne], { featureTapToEditTables: false });

    fireEvent.press(view.getByTestId('activity-row-tour-1'));
    expect(view.queryByTestId('activity-form-modal')).toBeNull();
  });

  it('enters edit mode and renders every row without throwing (regression: TDZ crash on selectedCellStyle)', () => {
    const { getByTestId } = renderActivityHarness([tourOne, tourTwo]);

    fireEvent.press(getByTestId('activity-table-edit'));

    expect(getByTestId('activity-table-save')).toBeTruthy();
    expect(getByTestId('activity-table-cancel')).toBeTruthy();
    expect(getByTestId('activity-row-tour-1')).toBeTruthy();
    expect(getByTestId('activity-row-tour-2')).toBeTruthy();
  });

  it('sorts the activity rows from headers in view and edit modes', () => {
    const rowIds = (getAllByTestId: (testId: RegExp) => Array<{ props: { testID: string } }>) =>
      getAllByTestId(/activity-row-/).map((row) => row.props.testID);

    const view = renderActivityHarness([tourOne, tourTwo]);
    expect(rowIds(view.getAllByTestId as any)).toEqual(['activity-row-tour-2', 'activity-row-tour-1']);
    fireEvent.press(view.getByTestId('activity-sort-name'));
    expect(rowIds(view.getAllByTestId as any)).toEqual(['activity-row-tour-2', 'activity-row-tour-1']);
    fireEvent.press(view.getByTestId('activity-sort-name'));
    expect(rowIds(view.getAllByTestId as any)).toEqual(['activity-row-tour-1', 'activity-row-tour-2']);
    view.unmount();

    const edit = renderActivityHarness([tourOne, tourTwo]);
    fireEvent.press(edit.getByTestId('activity-table-edit'));
    fireEvent.press(edit.getByTestId('activity-sort-name'));
    expect(rowIds(edit.getAllByTestId as any)).toEqual(['activity-row-tour-2', 'activity-row-tour-1']);
    expect(edit.getByTestId('activity-table-undo')).toBeTruthy();
    expect(edit.getByTestId('activity-table-redo')).toBeTruthy();
  });

  it('edits a cell and saves only the changed row via the bulk endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ updates: [{ id: 'tour-1', ok: true, activity: { ...tourOne, name: 'Updated Museum Tour' } }], deletes: [] }),
    });
    const { getByTestId, getByDisplayValue, queryByTestId } = renderActivityHarness([tourOne]);

    fireEvent.press(getByTestId('activity-table-edit'));
    fireEvent.changeText(getByDisplayValue('Museum Tour'), 'Updated Museum Tour');
    fireEvent.press(getByTestId('activity-table-save'));

    await waitFor(() => expect(queryByTestId('activity-table-save')).toBeNull(), ASYNC_WAIT_OPTIONS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as any).body));
    expect(body.updates).toEqual([{ id: 'tour-1', fields: { name: 'Updated Museum Tour' } }]);
    expect(body.deletes).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('reconciles rows that already succeeded so a retry after a partial failure does not resubmit them', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        updates: [{ id: 'tour-1', ok: false, error: 'Only the creator can edit this activity' }],
        deletes: [{ id: 'tour-2', ok: true }],
      }),
    });
    const { getByTestId, getByDisplayValue, getByText, queryByTestId } = renderActivityHarness([tourOne, tourTwo]);

    fireEvent.press(getByTestId('activity-table-edit'));
    fireEvent.changeText(getByDisplayValue('Museum Tour'), 'Updated Museum Tour');
    fireEvent.press(within(getByTestId('activity-row-tour-2')).getByText('Delete'));
    fireEvent.press(getByTestId('activity-table-save'));

    await waitFor(() => expect(getByText(/Some rows could not be saved/)).toBeTruthy(), ASYNC_WAIT_OPTIONS);
    // The session stays open (partial failure), the successfully-deleted row is gone,
    // and the still-failing row remains for the user to fix and retry.
    expect(queryByTestId('activity-row-tour-2')).toBeNull();
    expect(getByTestId('activity-row-tour-1')).toBeTruthy();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ updates: [{ id: 'tour-1', ok: true, activity: { ...tourOne, name: 'Updated Museum Tour' } }], deletes: [] }),
    });
    fireEvent.press(getByTestId('activity-table-save'));

    await waitFor(() => expect(queryByTestId('activity-table-save')).toBeNull(), ASYNC_WAIT_OPTIONS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String((fetchSpy.mock.calls[1][1] as any).body));
    // tour-2 must not be resubmitted for deletion — it already succeeded on the first attempt.
    expect(retryBody.deletes).toEqual([]);
    expect(retryBody.updates).toEqual([{ id: 'tour-1', fields: { name: 'Updated Museum Tour' } }]);
    fetchSpy.mockRestore();
  });
});
