/**
 * @jest-environment node
 */

import React, { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const renderActivityHarness = () => {
  const Harness = () => {
    const [tours, setTours] = useState<Tour[]>([]);
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
        mode="wizard"
      />
    );
  };

  return render(<Harness />);
};

describe('Activity dialog layout', () => {
  it('opens as a contained modal, saves the draft, and closes without a network request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    const { getByPlaceholderText, getByTestId, getByText, queryByTestId } = renderActivityHarness();

    fireEvent.press(getByTestId('activity-add'));

    expect(getByTestId('activity-form-modal')).toBeTruthy();
    expect(getByText('Add Activity')).toBeTruthy();
    expect(getByPlaceholderText('Activity name')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Activity name'), 'Museum Tour');
    fireEvent.changeText(getByPlaceholderText('Cost'), '$10');
    fireEvent.press(getByTestId('activity-save'));

    await waitFor(() => expect(queryByTestId('activity-form-modal')).toBeNull());
    expect(getByText('Museum Tour')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('closes the activity dialog from the cancel action', () => {
    const { getByTestId, queryByTestId } = renderActivityHarness();

    fireEvent.press(getByTestId('activity-add'));
    expect(getByTestId('activity-form-modal')).toBeTruthy();

    fireEvent.press(getByTestId('activity-cancel'));
    expect(queryByTestId('activity-form-modal')).toBeNull();
  });
});
