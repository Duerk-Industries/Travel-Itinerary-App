import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlightEditingForm } from '../components/FlightEditingForm';
import {
  buildFlightPayloadForCreate,
  createFlightDraftForTrip,
  type FlightEditDraft,
  type GroupMemberOption,
  type Trip,
} from '../tabs/flights';

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
  });
});
