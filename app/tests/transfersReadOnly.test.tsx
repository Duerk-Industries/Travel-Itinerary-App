/**
 * @jest-environment node
 */
/// <reference types="node" />

import React from 'react';
import { describe, expect, test, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { FlightsTab, type Flight, type GroupMemberOption, type Trip } from '../tabs/transfers';
import { getAppTheme } from '../theme/theme';
import DateField from '../components/DateField';
import { Platform } from 'react-native';

const styles = {
  card: {},
  flightsSection: {},
  row: {},
  sectionTitle: {},
  button: {},
  outlineButton: {},
  roundButton: {},
  buttonText: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  headerText: {},
  actionCell: {},
  tableActionButton: {},
  tableActionButtonPrimary: {},
  tableActionButtonDanger: {},
  cellText: {},
  warningText: {},
  smallButton: {},
  dangerButton: {},
};

const trip: Trip = {
  id: 'trip-1',
  groupId: 'group-1',
  groupName: 'Group',
  name: 'Followed Trip',
  destination: 'Bucharest',
  createdAt: '2026-01-01',
};

const member: GroupMemberOption = {
  id: 'member-1',
  firstName: 'Bryan',
  lastName: 'Traveler',
  email: 'bryan@example.com',
  status: 'active',
};

const vicky: GroupMemberOption = {
  id: 'member-2',
  firstName: 'Vicky',
  lastName: 'Duerk',
  email: 'vduerk@gmail.com',
  status: 'active',
};

const flight: Flight = {
  id: 'flight-1',
  trip_id: 'trip-1',
  status: 'Proposed',
  transfer_type: 'Flight',
  transferType: 'Flight',
  passenger_name: 'Bryan Traveler',
  passenger_ids: ['member-1'],
  departure_date: '2026-09-01',
  departure_location: 'MXP',
  departure_airport_code: 'MXP',
  departure_time: '08:00',
  arrival_date: '2026-09-01',
  arrival_location: 'OTP',
  arrival_airport_code: 'OTP',
  arrival_time: '11:00',
  layover_location: '',
  layover_location_code: '',
  layover_duration: '',
  cost: 124.58,
  carrier: 'Ryanair',
  flight_number: 'FR259',
  booking_reference: 'ABC123',
  paid_by: ['member-1'],
  paidBy: ['member-1'],
  netVotes: 0,
  userVote: null,
  netRating: 0,
  userRating: null,
};

describe('FlightsTab read-only mode', () => {
  beforeEach(() => {
    // FlightsTab refreshes its list on mount. Keep this suite self-contained so
    // that the background refresh cannot attempt localhost after Jest teardown.
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(['light', 'dark'] as const)('Details text follows the %s theme', mode => {
    const theme = getAppTheme(mode, 'light');
    const { getByTestId } = render(<FlightsTab transferScope="flights" backendUrl="http://localhost"
      userToken="token" activeTripId="trip-1" flights={[flight]} setFlights={jest.fn() as any}
      groupMembers={[member]} defaultPayerId="member-1" formatMemberName={m => m.firstName || m.id}
      payerName={() => 'Member'} headers={{}} jsonHeaders={{}} findActiveTrip={() => trip}
      fetchGroupMembersForActiveTrip={async () => {}} styles={styles} theme={theme}
      airportOptions={[]} onSearchAirports={() => {}} />);
    const button = getByTestId('transfer-details-flight-1');
    expect(button.findByType('Text').props.style).toEqual(expect.arrayContaining([{ color: theme.colors.text }]));
  });

  test.each(['flights', 'ground'] as const)('%s screen filters rows and totals, and offers the right transfer types', (transferScope) => {
    const ground: Flight = { ...flight, id: 'train-1', transfer_type: 'Train', transferType: 'Train', cost: 37 };
    const air: Flight = { ...flight, cost: 250 };
    const { getByTestId, queryByTestId, getByText, getAllByText, queryByText } = render(
      <FlightsTab
        transferScope={transferScope}
        backendUrl="http://localhost" userToken="token" activeTripId="trip-1"
        flights={[air, ground]} setFlights={jest.fn() as any} groupMembers={[member]} defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`} payerName={() => 'Bryan Traveler'}
        headers={{}} jsonHeaders={{}} findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={async () => {}} styles={styles} airportOptions={[]} onSearchAirports={() => {}}
      />
    );
    expect(getByTestId(`transfer-row-${transferScope === 'flights' ? 'flight-1' : 'train-1'}`)).toBeTruthy();
    expect(queryByTestId(`transfer-row-${transferScope === 'flights' ? 'train-1' : 'flight-1'}`)).toBeNull();
    expect(getByText(transferScope === 'flights' ? 'Total flight cost: $250.00' : 'Total ground transfer cost: $37.00')).toBeTruthy();
    fireEvent.press(getByTestId('transfer-add'));
    expect(getByTestId('flight-modal-save')).toBeTruthy();
    if (transferScope === 'ground') {
      expect(getByText('Other')).toBeTruthy();
      expect(queryByText('Flight')).toBeNull();
      expect(getAllByText('Provider')).toHaveLength(2);
      expect(queryByText('Carrier')).toBeNull();
      expect(queryByText('Layover')).toBeNull();
      expect(queryByTestId('flight-modal-flight-number')).toBeNull();
      expect(getByTestId('ground-departure-hotel').props.accessibilityState.disabled).toBe(true);
    } else {
      expect(queryByText('Other')).toBeNull();
    }
  });

  test('ground transfers fill plain-text locations from eligible hotel addresses without airport autocomplete', () => {
    const onSearchAirports = jest.fn(() => {});
    const { getByTestId, queryByTestId, UNSAFE_getAllByType } = render(
      <FlightsTab transferScope="ground" backendUrl="http://localhost" userToken="token" activeTripId="trip-1"
        flights={[{ ...flight, transferType: 'Train', transfer_type: 'Train' }]} setFlights={jest.fn() as any}
        lodgings={[
          { id: 'hotel', name: 'Hotel Today', address: '12 Main Street', checkInDate: '2026-09-01', checkOutDate: '2026-09-02', status: 'Booked' },
          { id: 'blank', name: 'No Address', address: '', checkInDate: '2026-09-01', checkOutDate: '2026-09-02', status: 'Booked' },
          { id: 'later', name: 'Later Hotel', address: '99 Later Road', checkInDate: '2026-09-10', checkOutDate: '2026-09-12', status: 'Booked' },
        ]}
        groupMembers={[member]} defaultPayerId="member-1" formatMemberName={m => m.firstName || m.id} payerName={() => 'Member'}
        headers={{}} jsonHeaders={{}} findActiveTrip={() => trip} fetchGroupMembersForActiveTrip={async () => {}}
        styles={styles} airportOptions={['London (LHR)']} onSearchAirports={onSearchAirports} />
    );
    fireEvent.press(getByTestId('transfer-row-flight-1'));
    expect(getByTestId('ground-transfer-screen-details')).toBeTruthy();
    fireEvent.press(getByTestId('flight-details-edit'));
    fireEvent.press(getByTestId('ground-departure-hotel'));
    expect(queryByTestId('ground-departure-hotel-blank')).toBeNull();
    fireEvent.press(getByTestId('ground-departure-hotel-hotel'));
    expect(getByTestId('flight-modal-departure-location').props.value).toBe('12 Main Street');
    fireEvent.changeText(getByTestId('flight-modal-departure-location'), 'A custom street address');
    expect(getByTestId('flight-modal-departure-location').props.value).toBe('A custom street address');
    expect(getByTestId('flight-modal-departure-location').props.onFocus).toBeUndefined();
    expect(getByTestId('flight-modal-departure-location').props.onBlur).toBeUndefined();
    fireEvent.press(getByTestId('ground-arrival-hotel'));
    fireEvent.press(getByTestId('ground-arrival-hotel-hotel'));
    expect(getByTestId('flight-modal-arrival-location').props.value).toBe('12 Main Street');
    expect(onSearchAirports).not.toHaveBeenCalled();
    const dateField = (testID: string) => UNSAFE_getAllByType(DateField).find(field => field.props.testID === testID)!;
    // An independently chosen arrival day must be reset by a later departure-date edit.
    fireEvent(dateField('transfer-arrival-date'), 'change', '2026-09-05');
    expect(getByTestId('ground-arrival-hotel').props.accessibilityState.disabled).toBe(true);
    fireEvent(dateField('transfer-departure-date'), 'change', '2026-09-10');
    expect(dateField('transfer-arrival-date').props.value).toBe('2026-09-10');
    fireEvent.press(getByTestId('ground-departure-hotel'));
    expect(queryByTestId('ground-departure-hotel-hotel')).toBeNull();
    fireEvent.press(getByTestId('ground-departure-hotel-later'));
    expect(getByTestId('flight-modal-departure-location').props.value).toBe('99 Later Road');
    fireEvent.press(getByTestId('ground-arrival-hotel'));
    expect(queryByTestId('ground-arrival-hotel-hotel')).toBeNull();
    fireEvent.press(getByTestId('ground-arrival-hotel-later'));
    expect(getByTestId('flight-modal-arrival-location').props.value).toBe('99 Later Road');
    fireEvent(dateField('transfer-arrival-date'), 'change', '2026-09-20');
    expect(getByTestId('ground-arrival-hotel').props.accessibilityState.disabled).toBe(true);
    expect(getByTestId('ground-departure-hotel').props.accessibilityState.disabled).toBe(false);
  });

  test('web modal date inputs refresh both hotel lists and survive an external-data refresh', () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    try {
      const transfer: Flight = { ...flight, transferType: 'Public Transit', transfer_type: 'Public Transit' };
      const props = {
        transferScope: 'ground' as const, backendUrl: 'http://localhost', userToken: 'token', activeTripId: 'trip-1',
        flights: [transfer], externalEditFlightId: transfer.id, setFlights: jest.fn() as any,
        lodgings: [
          { id: 'old', name: 'Old Hotel', address: 'Old address', checkInDate: '2026-09-01', checkOutDate: '2026-09-02', status: 'Booked' as const },
          { id: 'new', name: 'New Hotel', address: 'New address', checkInDate: '2026-09-10', checkOutDate: '2026-09-11', status: 'Booked' as const },
        ],
        groupMembers: [member], defaultPayerId: 'member-1', formatMemberName: (m: GroupMemberOption) => m.id,
        payerName: () => 'Member', headers: {}, jsonHeaders: {}, findActiveTrip: () => trip,
        fetchGroupMembersForActiveTrip: async () => {}, styles, airportOptions: [], onSearchAirports: () => {},
      };
      const { getByTestId, UNSAFE_root, rerender } = render(<FlightsTab {...props} />);
      const hotelSelect = (leg: string) => UNSAFE_root.findByProps({ 'data-testid': `ground-${leg}-hotel` });
      const options = (leg: string) => hotelSelect(leg).findAllByType('option').map((option: { props: { value: string } }) => option.props.value);
      expect(options('departure')).toContain('old');
      fireEvent(getByTestId('transfer-arrival-date'), 'change', { target: { value: '2026-09-05' } });
      fireEvent(getByTestId('transfer-departure-date'), 'change', { target: { value: '2026-09-10' } });
      expect(getByTestId('transfer-arrival-date').props.value).toBe('2026-09-10');
      expect(options('departure')).toEqual(['', 'new']);
      expect(options('arrival')).toEqual(['', 'new']);
      rerender(<FlightsTab {...props} flights={[{ ...transfer }]} />);
      expect(getByTestId('transfer-departure-date').props.value).toBe('2026-09-10');
      expect(getByTestId('transfer-arrival-date').props.value).toBe('2026-09-10');
      expect(options('arrival')).toEqual(['', 'new']);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }
  });

  test('opens the edit form when a row is tapped in editable mode', () => {
    const { getByTestId } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken="token"
        activeTripId="trip-1"
        flights={[flight]}
        setFlights={jest.fn() as any}
        groupMembers={[member]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
      />
    );

    fireEvent.press(getByTestId('transfer-row-flight-1'));
    expect(getByTestId('flight-screen-details')).toBeTruthy();
    fireEvent.press(getByTestId('flight-details-edit'));
    expect(getByTestId('flight-modal-save')).toBeTruthy();
  });

  test('opens a native date picker for departure and arrival while adding a transfer', () => {
    const theme = getAppTheme('dark', 'light');
    const { getByTestId } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken="token"
        activeTripId="trip-1"
        flights={[flight]}
        setFlights={jest.fn() as any}
        groupMembers={[member]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        theme={theme}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
      />,
    );

    fireEvent.press(getByTestId('transfer-add'));
    fireEvent.press(getByTestId('transfer-departure-date'));
    const departurePicker = getByTestId('native-date-time-picker');
    expect(departurePicker).toBeTruthy();
    expect(departurePicker.props.themeVariant).toBe('dark');
    expect(departurePicker.props.textColor).toBe(theme.colors.text);
    fireEvent.press(getByTestId('transfer-departure-date-cancel'));

    fireEvent.press(getByTestId('transfer-arrival-date'));
    expect(getByTestId('native-date-time-picker')).toBeTruthy();
    fireEvent.press(getByTestId('transfer-arrival-date-cancel'));
  });

  test('does not open the edit form on row tap when featureTapToEditTables is disabled', () => {
    // Kill-switch coverage for implementation-plan-ux-remediation.md Initiative A:
    // with the flag off, only the explicit Edit button (not the row itself) opens the modal.
    const { getByTestId, queryByTestId, getByLabelText } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken="token"
        activeTripId="trip-1"
        flights={[flight]}
        setFlights={jest.fn() as any}
        groupMembers={[member]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
        featureTapToEditTables={false}
      />
    );

    fireEvent.press(getByTestId('transfer-row-flight-1'));
    expect(queryByTestId('flight-modal-save')).toBeNull();

    fireEvent.press(getByLabelText('Close'));
    fireEvent.press(getByTestId('transfer-edit-flight-1'));
    expect(getByTestId('flight-modal-save')).toBeTruthy();
  });

  test('opens the sortable editable transfer grid', () => {
    const { getByTestId, getByText } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken="token"
        activeTripId="trip-1"
        flights={[flight]}
        setFlights={jest.fn() as any}
        groupMembers={[member]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
      />
    );

    fireEvent.press(getByTestId('transfer-table-edit'));
    expect(getByTestId('transfer-table-save')).toBeTruthy();
    expect(getByText('Departure Date')).toBeTruthy();
  });

  test('hides mutation controls for followed trips', () => {
    const { queryByTestId, getAllByText } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken={null}
        activeTripId="trip-1"
        flights={[flight]}
        setFlights={jest.fn() as any}
        groupMembers={[member]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
        readOnly
      />
    );

    expect(queryByTestId('transfer-paste')).toBeNull();
    expect(queryByTestId('transfer-add')).toBeNull();
    expect(queryByTestId('transfer-edit-flight-1')).toBeNull();
    expect(queryByTestId('transfer-delete-flight-1')).toBeNull();
    expect(queryByTestId('flight-vote-up-flight-1')).toBeNull();
    expect(getAllByText('View only').length).toBeGreaterThan(0);
  });

  test('uses known member names when legacy passenger text contains an email', () => {
    const emailFallbackFlight: Flight = {
      ...flight,
      passenger_name: 'Bryan Traveler, vduerk@gmail.com',
      passenger_ids: [],
    };

    const { getByText, queryByText } = render(
      <FlightsTab
        backendUrl="http://localhost"
        userToken={null}
        activeTripId="trip-1"
        flights={[emailFallbackFlight]}
        setFlights={jest.fn() as any}
        groupMembers={[member, vicky]}
        defaultPayerId="member-1"
        formatMemberName={(m) => `${m.firstName} ${m.lastName}`.trim()}
        payerName={() => 'Bryan Traveler'}
        headers={{}}
        jsonHeaders={{}}
        findActiveTrip={() => trip}
        fetchGroupMembersForActiveTrip={jest.fn(() => Promise.resolve()) as any}
        styles={styles}
        airportOptions={[]}
        onSearchAirports={jest.fn() as any}
        readOnly
      />
    );

    expect(getByText('Bryan Traveler, Vicky Duerk')).toBeTruthy();
    expect(queryByText(/vduerk@gmail\.com/i)).toBeNull();
  });
});
