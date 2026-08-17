/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlightEditingForm } from '../components/TransferEditingForm';
import {
  buildFlightPayloadForCreate,
  canonicalizeMemberSelectionIds,
  createFlightDraftForTrip,
  type FlightEditDraft,
  type GroupMemberOption,
  type Trip,
} from '../tabs/transfers';

// Silence React act warnings in react-test-renderer.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Flights dialog', () => {
  const trip: Trip = {
    id: 'trip-1',
    groupId: 'group-1',
    groupName: 'Group',
    name: 'Test Trip',
    createdAt: '2026-01-01',
  };

  const member: GroupMemberOption = {
    id: 'member-1',
    email: 'member@example.com',
    firstName: 'Test',
    lastName: 'Member',
    status: 'active',
  };

  const styles = {};

  const pressAllByText = (root: any, label: string) => {
    const textNodes = root.findAll((node: any) => node.type === 'Text' && node.props.children === label);
    if (!textNodes.length) {
      throw new Error(`Button with label "${label}" not found.`);
    }
    textNodes.forEach((textNode: any) => {
      if (textNode.parent?.props.onPress) {
        textNode.parent.props.onPress();
      }
    });
  };

  const Harness = ({ onSave }: { onSave: (flight: FlightEditDraft) => void }) => {
    const [flight, setFlight] = useState<FlightEditDraft | null>(() => {
      const draft = createFlightDraftForTrip(trip, member.id);
      draft.passengerIds = [member.id];
      draft.passengerName = member.email ?? 'Member';
      return draft;
    });
    if (!flight) return null;
    return (
      <FlightEditingForm
        visible
        flightId="new"
        flight={flight}
        groupMembers={[member]}
        userMembers={[member]}
        styles={styles}
        formatMemberName={(m) => m.email ?? m.firstName ?? m.id}
        payerName={() => member.email ?? 'Member'}
        airportTarget={null}
        getLocationInputValue={(raw) => raw}
        showAirportDropdown={jest.fn()}
        onAirportEnter={jest.fn()}
        parseLayoverDuration={() => ({ hours: '', minutes: '' })}
        openTimePicker={jest.fn()}
        setFlight={setFlight}
        setPassengerIds={(ids) => setFlight((prev) => (prev ? { ...prev, passengerIds: ids } : prev))}
        modalDepLocationRef={{ current: null }}
        modalArrLocationRef={{ current: null }}
        modalLayoverLocationRef={{ current: null }}
        onClose={jest.fn()}
        onSave={() => onSave(flight)}
      />
    );
  };

  test('saves dialog input with passengers and full details', () => {
    const saved: any[] = [];
    const onSave = (flight: FlightEditDraft) => {
      const { payload, error } = buildFlightPayloadForCreate(flight, trip.id, member.id);
      if (error || !payload) throw new Error(error || 'missing payload');
      saved.push(payload);
    };

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(<Harness onSave={onSave} />);
    });
    const root = testRenderer!.root;

    act(() => {
      root.findByProps({ testID: 'flight-modal-departure-location' }).props.onChangeText('JFK');
      root.findByProps({ testID: 'flight-modal-arrival-location' }).props.onChangeText('LAX');
      root.findByProps({ testID: 'flight-modal-carrier' }).props.onChangeText('Delta');
      root.findByProps({ testID: 'flight-modal-flight-number' }).props.onChangeText('DL100');
      root.findByProps({ testID: 'flight-modal-booking-reference' }).props.onChangeText('ABC123');
      root.findByProps({ testID: 'flight-modal-cost' }).props.onChangeText('200');
    });

    act(() => {
      root.findByProps({ testID: 'flight-modal-save' }).props.onPress();
    });

    expect(saved).toHaveLength(1);
    expect(saved[0].passengerIds).toEqual([member.id]);
    expect(saved[0].departureLocation).toBe('JFK');
    expect(saved[0].arrivalLocation).toBe('LAX');
    expect(saved[0].carrier).toBe('Delta');
    expect(saved[0].flightNumber).toBe('DL100');
    expect(saved[0].bookingReference).toBe('ABC123');
    expect(saved[0].cost).toBe(200);
    expect(saved[0].tripId).toBe(trip.id);
    expect(saved[0].transferType).toBe('Flight');
  });

  test('uses traveler names for toggles and updates payers/passengers', () => {
    const pendingMember: GroupMemberOption = {
      id: 'member-2',
      email: 'pending@example.com',
      firstName: 'Pending',
      lastName: 'Traveler',
      status: 'pending',
    };
    const emailOnlyMember: GroupMemberOption = {
      id: 'member-3',
      email: 'emailonly@example.com',
      status: 'pending',
    };

    const saved: any[] = [];

    const Harness = ({ onSave }: { onSave: (flight: FlightEditDraft) => void }) => {
      const [flight, setFlight] = useState<FlightEditDraft | null>(() => {
        const draft = createFlightDraftForTrip(trip, member.id);
        draft.passengerIds = [member.id];
        draft.paidBy = [member.id];
        draft.passengerName = member.email ?? 'Member';
        return draft;
      });
      if (!flight) return null;
      return (
        <FlightEditingForm
          visible
          flightId="new"
          flight={flight}
          groupMembers={[member, pendingMember, emailOnlyMember]}
          userMembers={[member, pendingMember, emailOnlyMember]}
          styles={styles}
          formatMemberName={(m) => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || m.id}
          payerName={() => member.email ?? 'Member'}
          airportTarget={null}
          getLocationInputValue={(raw) => raw}
          showAirportDropdown={jest.fn()}
          onAirportEnter={jest.fn()}
          parseLayoverDuration={() => ({ hours: '', minutes: '' })}
          openTimePicker={jest.fn()}
          setFlight={setFlight}
          setPassengerIds={(ids) => setFlight((prev) => (prev ? { ...prev, passengerIds: ids } : prev))}
          modalDepLocationRef={{ current: null }}
          modalArrLocationRef={{ current: null }}
          modalLayoverLocationRef={{ current: null }}
          onClose={jest.fn()}
          onSave={() => onSave(flight)}
        />
      );
    };

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <Harness
          onSave={(flight: FlightEditDraft) => {
            const { payload, error } = buildFlightPayloadForCreate(flight, trip.id, member.id);
            if (error || !payload) throw new Error(error || 'missing payload');
            saved.push(payload);
          }}
        />
      );
    });
    const root = testRenderer!.root;

    // Name uses first/last for pending member and email fallback for email-only.
    expect(root.findAllByProps({ children: 'Pending Traveler' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ children: 'emailonly@example.com' }).length).toBeGreaterThan(0);

    act(() => {
      pressAllByText(root, 'Pending Traveler');
    });
    act(() => {
      pressAllByText(root, 'emailonly@example.com');
    });

    act(() => {
      root.findByProps({ testID: 'flight-modal-save' }).props.onPress();
    });

    expect(saved).toHaveLength(1);
    expect(saved[0].passengerIds).toEqual(['member-1', 'member-2', 'member-3']);
    expect(saved[0].paidBy).toEqual(['member-1', 'member-2', 'member-3']);
  });

  test('does not render caret buttons in location fields', () => {
    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <FlightEditingForm
          visible
          flightId="new"
          flight={createFlightDraftForTrip(trip, member.id)}
          groupMembers={[member]}
          userMembers={[member]}
          styles={styles}
          formatMemberName={(m) => m.email ?? m.firstName ?? m.id}
          payerName={() => member.email ?? 'Member'}
          airportTarget={null}
          getLocationInputValue={(raw) => raw}
          showAirportDropdown={jest.fn()}
          onAirportEnter={jest.fn()}
          parseLayoverDuration={() => ({ hours: '', minutes: '' })}
          openTimePicker={jest.fn()}
          setFlight={jest.fn()}
          setPassengerIds={jest.fn()}
          modalDepLocationRef={{ current: null }}
          modalArrLocationRef={{ current: null }}
          modalLayoverLocationRef={{ current: null }}
          onClose={jest.fn()}
          onSave={jest.fn()}
        />
      );
    });
    const root = testRenderer!.root;

    const depInput = root.findByProps({ testID: 'flight-modal-departure-location' });
    const depContainer = depInput.parent;
    expect(depContainer.findAllByType('TouchableOpacity')).toHaveLength(0);

    const arrInput = root.findByProps({ testID: 'flight-modal-arrival-location' });
    const arrContainer = arrInput.parent;
    expect(arrContainer.findAllByType('TouchableOpacity')).toHaveLength(0);

    const layoverInput = root.findByProps({ testID: 'flight-modal-layover-location' });
    const layoverContainer = layoverInput.parent;
    expect(layoverContainer.findAllByType('TouchableOpacity')).toHaveLength(0);
  });

  test('canonicalizes legacy linked user ids to member ids for edit selections', () => {
    expect(
      canonicalizeMemberSelectionIds(
        ['user-legacy', 'member-1'],
        [
          { id: 'member-1', userId: 'user-legacy' },
          { id: 'member-2', userId: 'user-other' },
        ]
      )
    ).toEqual(['member-1']);
  });

  // Regression: clicking a modal airport-dropdown option on web did nothing (except when exactly
  // one suggestion remained) because the field's onBlur fired first and hid the dropdown before
  // the click could land. onAirportOptionPressIn is the caller's hook to suppress that — verify
  // this component actually calls it, in the right order relative to onSelectAirport.
  test('fires onAirportOptionPressIn before onSelectAirport when a dropdown option is clicked', () => {
    const calls: string[] = [];
    const onAirportOptionPressIn = jest.fn(() => calls.push('pressIn'));
    const onSelectAirport = jest.fn((..._args: any[]) => calls.push('select'));
    const airports = [
      { iata_code: 'JFK', name: 'John F. Kennedy Intl', city: 'New York' },
      { iata_code: 'LGA', name: 'LaGuardia', city: 'New York' },
    ];

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <FlightEditingForm
          visible
          flightId="new"
          flight={createFlightDraftForTrip(trip, member.id)}
          groupMembers={[member]}
          userMembers={[member]}
          styles={styles}
          formatMemberName={(m) => m.email ?? m.firstName ?? m.id}
          payerName={() => member.email ?? 'Member'}
          airportTarget="modal-dep"
          airportAnchor={{ x: 0, y: 0, width: 200, height: 40 }}
          airportSuggestions={airports}
          formatAirportLabel={(a) => `${a.name} (${a.iata_code})`}
          onAirportOptionPressIn={onAirportOptionPressIn}
          onSelectAirport={onSelectAirport}
          getLocationInputValue={(raw) => raw}
          showAirportDropdown={jest.fn()}
          onAirportEnter={jest.fn()}
          parseLayoverDuration={() => ({ hours: '', minutes: '' })}
          openTimePicker={jest.fn()}
          setFlight={jest.fn()}
          setPassengerIds={jest.fn()}
          modalDepLocationRef={{ current: null }}
          modalArrLocationRef={{ current: null }}
          modalLayoverLocationRef={{ current: null }}
          onClose={jest.fn()}
          onSave={jest.fn()}
        />
      );
    });
    const root = testRenderer!.root;

    const option = root.findByProps({ children: 'LaGuardia (LGA)' }).parent;
    act(() => {
      option.props.onPressIn?.();
      option.props.onPress();
    });

    expect(onAirportOptionPressIn).toHaveBeenCalledTimes(1);
    expect(onSelectAirport).toHaveBeenCalledWith('modal-dep', airports[1]);
    expect(calls).toEqual(['pressIn', 'select']);
  });

  // Regression: the time-of-day picker for the edit modal used to render as a sibling outside
  // this component's <Modal>, so on iOS it was mounted but invisible (a native Modal presents in
  // its own window above everything else). It must render inside this component's Modal instead.
  test('renders the native time picker inside the modal for an edit-dep target', () => {
    const FakeTimePicker = (props: any) => {
      pickerProps = props;
      return null;
    };
    let pickerProps: any = null;
    const onTimePickerChange = jest.fn();

    let testRenderer: any;
    act(() => {
      testRenderer = renderer.create(
        <FlightEditingForm
          visible
          flightId="new"
          flight={createFlightDraftForTrip(trip, member.id)}
          groupMembers={[member]}
          userMembers={[member]}
          styles={styles}
          formatMemberName={(m) => m.email ?? m.firstName ?? m.id}
          payerName={() => member.email ?? 'Member'}
          airportTarget={null}
          getLocationInputValue={(raw) => raw}
          showAirportDropdown={jest.fn()}
          onAirportEnter={jest.fn()}
          parseLayoverDuration={() => ({ hours: '', minutes: '' })}
          openTimePicker={jest.fn()}
          timePickerTarget="edit-dep"
          timePickerValue={new Date('2026-07-31T08:00:00.000Z')}
          onTimePickerChange={onTimePickerChange}
          nativeDateTimePicker={FakeTimePicker}
          setFlight={jest.fn()}
          setPassengerIds={jest.fn()}
          modalDepLocationRef={{ current: null }}
          modalArrLocationRef={{ current: null }}
          modalLayoverLocationRef={{ current: null }}
          onClose={jest.fn()}
          onSave={jest.fn()}
        />
      );
    });
    const root = testRenderer!.root;

    expect(root.findAllByType(FakeTimePicker)).toHaveLength(1);
    expect(pickerProps).toBeTruthy();

    const date = new Date('2026-07-31T09:30:00.000Z');
    act(() => {
      pickerProps.onChange({ type: 'set' }, date);
    });
    expect(onTimePickerChange).toHaveBeenCalledWith({ type: 'set' }, date, 'edit-dep');
  });
});

