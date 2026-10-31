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
    Keyboard: { dismiss: jest.fn() },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
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

const sampleTour: Tour = {
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
  netVotes: 2,
  userVote: 1,
  averageRating: 4.5,
  ratingCount: 2,
  userStars: 5,
};

const renderActivityHarness = (
  initialTours: Tour[] = [],
  defaultActivityDate?: string | null,
  featureStandardizedItemDialogs = false,
  theme?: any,
) => {
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
        fetchTours={jest.fn()}
        mode="wizard"
        lodgings={[
          { id: 'hotel-late', name: 'Late Hotel', checkInDate: '2027-05-07' },
          { id: 'hotel-1', name: 'Central Hotel', checkInDate: '2027-05-04', checkOutDate: '2027-05-06' },
          { id: 'hotel-early', name: 'Early Hotel', checkInDate: '2027-05-01' },
        ]}
        defaultActivityDate={defaultActivityDate}
        featureStandardizedItemDialogs={featureStandardizedItemDialogs}
        theme={theme}
      />
    );
  };

  return render(<Harness />);
};

describe('Activity dialog layout', () => {
  it.each([
    ['light', { mode: 'light', colors: { text: '#111827', textMuted: '#6B7280', border: '#E6ECEF', surface: '#FFFFFF', link: '#45B7C6' } }],
    ['dark', { mode: 'dark', colors: { text: '#E6ECEF', textMuted: '#B8C2CC', border: '#385266', surface: '#243647', link: '#5FD2E0' } }],
  ])('uses the %s theme colors throughout the standardized activity details dialog', (_mode, theme) => {
    const { getByTestId, getByText } = renderActivityHarness([sampleTour], undefined, true, theme);

    fireEvent.press(getByTestId('activity-details-tour-1'));

    const dialog = within(getByTestId('activity-details-modal'));
    expect(dialog.getByText('Museum Tour').props.style.color).toBe(theme.colors.text);
    expect(dialog.getByText('Date').props.style.color).toBe(theme.colors.text);
    expect(dialog.getByLabelText('Add to calendar')).toBeTruthy();
  });

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

  it('saves an optional activity near a hotel without assigning a day', async () => {
    const { getByTestId, getByPlaceholderText, getByText, queryByTestId } = renderActivityHarness([], '2027-05-01');
    fireEvent.press(getByTestId('activity-add'));
    fireEvent.press(within(getByTestId('activity-scheduling')).getByLabelText('Activity scheduling'));
    fireEvent.press(getByTestId('activity-scheduling-option-optional'));
    expect(getByText('Add Optional Activity')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('Activity name'), 'Nearby museum');
    fireEvent.press(within(getByTestId('activity-near-hotel')).getByLabelText('Near hotel'));
    fireEvent.press(getByTestId('activity-near-hotel-option-hotel-1'));
    fireEvent.press(getByTestId('activity-save'));
    await waitFor(() => expect(queryByTestId('activity-form-modal')).toBeNull());
    expect(getByText('Optional')).toBeTruthy();
  });

  it('switches between date and hotel dropdowns and orders hotels by check-in date', () => {
    const { getByTestId, queryByTestId } = renderActivityHarness([], '2027-05-02');
    fireEvent.press(getByTestId('activity-add'));
    expect(within(getByTestId('activity-scheduling')).getByText('Scheduled')).toBeTruthy();
    expect(getByTestId('activity-date')).toBeTruthy();
    expect(queryByTestId('activity-near-hotel')).toBeNull();
    fireEvent.press(within(getByTestId('activity-scheduling')).getByLabelText('Activity scheduling'));
    fireEvent.press(getByTestId('activity-scheduling-option-optional'));
    expect(queryByTestId('activity-date')).toBeNull();
    expect(within(getByTestId('activity-near-hotel')).getByText('No hotel — available every day')).toBeTruthy();
    fireEvent.press(within(getByTestId('activity-near-hotel')).getByLabelText('Near hotel'));
    const hotelOptions = within(getByTestId('activity-near-hotel-options')).getAllByTestId(/^activity-near-hotel-option-/);
    expect(hotelOptions.map((option) => option.props.testID)).toEqual([
      'activity-near-hotel-option-none', 'activity-near-hotel-option-hotel-early',
      'activity-near-hotel-option-hotel-1', 'activity-near-hotel-option-hotel-late',
    ]);
    fireEvent.press(getByTestId('activity-near-hotel-option-none'));
    fireEvent.press(within(getByTestId('activity-scheduling')).getByLabelText('Activity scheduling'));
    fireEvent.press(getByTestId('activity-scheduling-option-none'));
    expect(queryByTestId('activity-near-hotel')).toBeNull();
    expect(within(getByTestId('activity-form-modal')).getByText('2027-05-02')).toBeTruthy();
  });

  it('places optional activities after the nearby hotel checkout day and unlinked options last', () => {
    const { getAllByTestId } = renderActivityHarness([
      { ...sampleTour, id: 'optional-nearby', date: '', nearLodgingId: 'hotel-1', startTime: '00:01' },
      { ...sampleTour, id: 'next-day', date: '2027-05-07' },
      { ...sampleTour, id: 'optional-anywhere', date: '', nearLodgingId: null },
      { ...sampleTour, id: 'checkout-late', date: '2027-05-06', startTime: '23:59' },
      { ...sampleTour, id: 'checkout-early', date: '2027-05-06', startTime: '08:00' },
    ]);
    expect(getAllByTestId(/^activity-row-/).map((row) => row.props.testID)).toEqual([
      'activity-row-checkout-early', 'activity-row-checkout-late', 'activity-row-optional-nearby',
      'activity-row-next-day', 'activity-row-optional-anywhere',
    ]);
  });

  it('defaults new activities to the trip first date when provided', () => {
    const { getByTestId, getByText } = renderActivityHarness([], '2026-07-01');

    fireEvent.press(getByTestId('activity-add'));

    expect(getByText('2026-07-01')).toBeTruthy();
  });

  it('opens native pickers for the activity and free-cancellation dates', () => {
    const { getByTestId } = renderActivityHarness();

    fireEvent.press(getByTestId('activity-add'));
    fireEvent.press(getByTestId('activity-date'));
    expect(getByTestId('native-date-time-picker')).toBeTruthy();
    fireEvent.press(getByTestId('activity-date-cancel'));

    fireEvent.press(getByTestId('activity-free-cancellation-date'));
    expect(getByTestId('native-date-time-picker')).toBeTruthy();
    fireEvent.press(getByTestId('activity-free-cancellation-date-cancel'));
  });

  it('closes the activity dialog from the cancel action', () => {
    const { getByTestId, queryByTestId } = renderActivityHarness();

    fireEvent.press(getByTestId('activity-add'));
    expect(getByTestId('activity-form-modal')).toBeTruthy();

    fireEvent.press(getByTestId('activity-cancel'));
    expect(queryByTestId('activity-form-modal')).toBeNull();
  });

  it('keeps the table compact and opens full activity details from the activity name', () => {
    const { getByTestId, getByText, queryByTestId, queryByText } = renderActivityHarness([sampleTour]);

    const headerLabels = React.Children.toArray(getByTestId('activity-table-header').props.children).map(
      (cell: any) => cell.props.children.props.children
    );
    expect(headerLabels).toEqual(['Date', 'Type', 'Activity', 'Start Time', 'Duration', 'Status', 'Rating']);

    expect(queryByText('Platform Booked On')).toBeNull();
    expect(queryByText('Free Cancel By')).toBeNull();
    expect(queryByText('Reference')).toBeNull();
    expect(queryByText('Description')).toBeNull();
    expect(queryByText('Paid by')).toBeNull();
    expect(queryByText('Attendees')).toBeNull();
    expect(queryByText('Votes')).toBeNull();
    expect(queryByText('Actions')).toBeNull();
    expect(queryByTestId('activity-edit-tour-1')).toBeNull();

    fireEvent.press(getByTestId('activity-details-tour-1'));

    expect(getByTestId('activity-details-modal')).toBeTruthy();
    expect(getByText('Platform Booked On')).toBeTruthy();
    expect(getByText('Free Cancel By')).toBeTruthy();
    expect(getByText('Reference')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
    expect(getByText('Paid by')).toBeTruthy();
    expect(getByText('Attendees')).toBeTruthy();
    expect(queryByText('Votes')).toBeNull();
    expect(getByText('Actions')).toBeTruthy();
    expect(getByText('Viator')).toBeTruthy();
    expect(getByText('TOUR1')).toBeTruthy();
    expect(getByText('Bring comfortable walking shoes.')).toBeTruthy();

    fireEvent.press(getByTestId('activity-details-edit-tour-1'));

    expect(queryByTestId('activity-details-modal')).toBeNull();
    expect(getByTestId('activity-form-modal')).toBeTruthy();
    expect(getByText('Edit Activity')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
  });
});
