/**
 * @jest-environment node
 */
/// <reference types="node" />

import React from 'react';
import { describe, expect, test, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { FlightsTab, type Flight, type GroupMemberOption, type Trip } from '../tabs/transfers';

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
    expect(getByTestId('flight-modal-save')).toBeTruthy();
  });

  test('does not open the edit form on row tap when featureTapToEditTables is disabled', () => {
    // Kill-switch coverage for implementation-plan-ux-remediation.md Initiative A:
    // with the flag off, only the explicit Edit button (not the row itself) opens the modal.
    const { getByTestId, queryByTestId } = render(
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
