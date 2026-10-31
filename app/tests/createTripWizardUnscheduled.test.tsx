/** @jest-environment node */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import CreateTripWizard from '../tabs/createTripWizard';

jest.mock('../components/LocationSelector', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return { LocationSelector: ({ onAddLocation }: { onAddLocation: (location: unknown) => void }) => React.createElement(TouchableOpacity, {
    testID: 'choose-destination', onPress: () => onAddLocation({ id: 'japan', name: 'Japan', sourceType: 'country' }),
  }, React.createElement(Text, null, 'Choose Japan')) };
});

const styles = new Proxy({}, { get: () => ({}) });
const props = {
  backendUrl: 'http://localhost', userToken: 'token', headers: {}, traits: [], airportOptions: [],
  onSearchAirports: jest.fn(), styles, onCancel: jest.fn(), onTripCreated: jest.fn(),
  onAiItineraryQueued: jest.fn(), onUnauthorized: jest.fn(), onWizardCarRentals: jest.fn(),
  currentUserName: 'Alex Traveler', currentUserEmail: 'alex@example.com',
};

describe('unscheduled trip creation', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api/trips/wizard') ? { trip: { id: 'trip' } } : url.endsWith('/api/itineraries') ? { id: 'itinerary' } : [] }));
    global.fetch = fetchMock;
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('creates from Quick Start with no dates or trip length at all', async () => {
    const screen = render(<CreateTripWizard {...props} />);
    fireEvent.changeText(screen.getByTestId('quick-start-trip-name'), 'Someday Japan');
    fireEvent.press(screen.getByTestId('choose-destination'));
    fireEvent.press(screen.getByTestId('quick-start-create'));
    await waitFor(() => expect(props.onTripCreated).toHaveBeenCalled());
    const create = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/trips/wizard'))!;
    const body = JSON.parse(create[1].body);
    expect(body.startDate).toBeUndefined();
    expect(body.endDate).toBeUndefined();
    expect(body.durationDays).toBeUndefined();
  });

  it('creates from Quick Start with a trip length instead of calendar dates', async () => {
    const screen = render(<CreateTripWizard {...props} />);
    fireEvent.changeText(screen.getByTestId('quick-start-trip-name'), 'Someday Japan');
    fireEvent.press(screen.getByTestId('choose-destination'));
    fireEvent.press(screen.getByTestId('quick-start-dates-unscheduled'));
    expect(screen.queryByTestId('quick-start-start-date')).toBeNull();
    // Trip length is optional, but what is typed still has to be a whole number of days.
    expect(screen.getByTestId('quick-start-create').props.disabled).toBeFalsy();
    fireEvent.changeText(screen.getByTestId('quick-start-trip-length'), '1.5');
    expect(screen.getByTestId('quick-start-create').props.disabled).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('quick-start-trip-length'), '7');
    fireEvent.press(screen.getByTestId('quick-start-create'));
    await waitFor(() => expect(props.onTripCreated).toHaveBeenCalled());
    const create = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/trips/wizard'))!;
    const body = JSON.parse(create[1].body);
    expect(body.durationDays).toBe(7);
    expect(body.startDate).toBeUndefined();
    expect(body.endDate).toBeUndefined();
    expect(body.startMonth).toBeUndefined();
    expect(body.startYear).toBeUndefined();
  });

  it('asks for a month when Dates not set is chosen, and holds the 1st of its next occurrence as the start', async () => {
    const screen = render(<CreateTripWizard {...props} />);
    fireEvent.changeText(screen.getByTestId('quick-start-trip-name'), 'Someday Japan');
    fireEvent.press(screen.getByTestId('choose-destination'));
    fireEvent.press(screen.getByTestId('quick-start-dates-unscheduled'));
    fireEvent.press(screen.getByTestId('wizard-month-prompt-11'));
    expect(screen.getByTestId('wizard-month-change')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('quick-start-trip-length'), '7');
    fireEvent.press(screen.getByTestId('quick-start-create'));
    await waitFor(() => expect(props.onTripCreated).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/trips/wizard'))![1].body);
    expect(body.startMonth).toBe(11);
    expect(body.startDate).toMatch(/^\d{4}-11-01$/);
    expect(body.endDate).toMatch(/^\d{4}-11-07$/);
    expect(body.durationDays).toBe(7);
  });

  it('keeps the trip undated when the month prompt is skipped', async () => {
    const screen = render(<CreateTripWizard {...props} />);
    fireEvent.changeText(screen.getByTestId('quick-start-trip-name'), 'Someday Japan');
    fireEvent.press(screen.getByTestId('choose-destination'));
    fireEvent.press(screen.getByTestId('quick-start-dates-unscheduled'));
    fireEvent.press(screen.getByTestId('wizard-month-prompt-skip'));
    fireEvent.changeText(screen.getByTestId('quick-start-trip-length'), '7');
    fireEvent.press(screen.getByTestId('quick-start-create'));
    await waitFor(() => expect(props.onTripCreated).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/trips/wizard'))![1].body);
    expect(body.startDate).toBeUndefined();
    expect(body.startMonth).toBeUndefined();
  });

  it('offers the same option in the full wizard and saves the chosen number of days and item day numbers', async () => {
    const screen = render(<CreateTripWizard {...props} featureQuickStartTripWizard={false} aiItineraryGenerationAllowed={false} />);
    fireEvent.changeText(screen.getByLabelText('Trip name'), 'Someday Japan');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByTestId('wizard-dates-unscheduled'));
    expect(screen.queryByTestId('wizard-start-date')).toBeNull();
    fireEvent.changeText(screen.getByTestId('wizard-trip-length'), '4');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Day 1')).toBeTruthy();
    expect(screen.getByText('Day 4')).toBeTruthy();
    expect(screen.queryByText('Day 5')).toBeNull();
    fireEvent.press(screen.getByLabelText('Add item to Day 4'));
    fireEvent.changeText(screen.getByLabelText('Activity description'), 'Explore the city');
    fireEvent.press(screen.getByText('Add Itinerary Item'));
    fireEvent.press(screen.getByText('Done'));
    fireEvent.press(screen.getByText('Finish Trip'));
    await waitFor(() => expect(props.onTripCreated).toHaveBeenCalled());
    const itinerary = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/itineraries'))!;
    expect(JSON.parse(itinerary[1].body).days).toBe(4);
    const item = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/itineraries/itinerary/details'))!;
    expect(JSON.parse(item[1].body)).toMatchObject({ day: 4, activity: 'Explore the city' });
  });
});
