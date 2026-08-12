/**
 * @jest-environment node
 */
/// <reference types="node" />

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  buildOverviewRows,
  formatFlightSummary,
  formatLodgingSummary,
  formatTourSummary,
} from '../utils/overviewBuilder';
import {
  buildFlightDraftFromRow,
  buildRentalDraftFromRow,
  buildTourDraftFromRow,
} from '../utils/overviewEditing';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Image } from 'react-native';
import { OverviewTab, buildDayWeatherLocation, makeWeatherLocationGeofriendly } from '../tabs/overview';
import React from 'react';

describe('Overview helpers', () => {
  test('chooses the first lodging location for day weather', () => {
    const location = buildDayWeatherLocation(
      {
        lodgings: [
          { name: 'First Hotel', address: 'First Hotel Address' },
          { name: 'Second Hotel', address: 'Second Hotel Address' },
        ] as any,
        flights: [
          { arrival_airport_code: 'OTP', arrival_location: 'Bucharest' },
        ] as any,
        tours: [],
        rentals: [],
      },
      'Romania'
    );

    expect(location).toBe('First Hotel Address');
  });

  test('makes street-address weather locations geocoder friendly', () => {
    expect(makeWeatherLocationGeofriendly('3751 N Tracy Blvd Tracy CALIFORNIA 95304 US')).toBe(
      'Tracy, CALIFORNIA, US'
    );
  });

  test('uses a geocoder-friendly lodging address for day weather', () => {
    const location = buildDayWeatherLocation(
      {
        lodgings: [
          { name: 'Holiday Inn Express & Suites TRACY by IHG', address: '3751 N Tracy Blvd Tracy CALIFORNIA 95304 US' },
        ] as any,
        flights: [],
        tours: [],
        rentals: [],
      },
      'Yosemite National Park'
    );

    expect(location).toBe('Tracy, CALIFORNIA, US');
  });

  test('uses the first arrival airport for day weather when lodging is unavailable', () => {
    const location = buildDayWeatherLocation(
      {
        lodgings: [],
        flights: [
          { arrival_airport_code: 'OTP', arrival_location: 'Bucharest' },
          { arrival_airport_code: 'CLJ', arrival_location: 'Cluj-Napoca' },
        ] as any,
        tours: [{ startLocation: 'Trailhead' }] as any,
        rentals: [{ pickupLocation: 'Rental counter' }] as any,
      },
      'Romania'
    );

    expect(location).toBe('OTP');
  });

  test('formats flight summary', () => {
    const summary = formatFlightSummary({
      id: 'f1',
      carrier: 'Delta',
      flight_number: 'DL100',
      departure_airport_code: 'JFK',
      arrival_airport_code: 'LAX',
      departure_time: '08:00',
      arrival_time: '11:00',
    });
    expect(summary).toBe('Delta DL100 from JFK to LAX at 08:00 - 11:00');
  });

  test('formats lodging summary', () => {
    const summary = formatLodgingSummary({
      id: 'l1',
      name: 'Hotel Test',
      checkInDate: '2025-04-10',
      checkOutDate: '2025-04-12',
    });
    expect(summary).toBe('Hotel Test at 2025-04-10');
  });

  test('formats tour summary', () => {
    const summary = formatTourSummary({
      id: 't1',
      name: 'City Tour',
      date: '2025-04-10',
      startTime: '10:00',
      startLocation: 'Downtown',
    });
    expect(summary).toBe('City Tour at 10:00 at Downtown');
  });

  test('builds editing drafts from rows', () => {
    const flight = {
      id: 'f2',
      passenger_name: 'Claire',
      departure_date: '2026-05-01',
      departure_airport_code: 'SFO',
      departure_time: '09:00',
      arrival_airport_code: 'SEA',
      arrival_time: '11:00',
      layover_location: 'PDX',
      layover_location_code: 'PDX',
      layover_duration: '1h',
      cost: 120,
      carrier: 'Alaska',
      flight_number: 'AS200',
      booking_reference: 'REF200',
    };
    const flightDraft = buildFlightDraftFromRow(flight as any);
    expect(flightDraft.carrier).toBe('Alaska');
    expect(flightDraft.cost).toBe('120');
    const tour = {
      id: 'tour-1',
      date: '2026-05-02',
      name: 'Harbor Cruise',
      startLocation: 'Pier 55',
      startTime: '14:00',
      duration: '2h',
      cost: '80',
      freeCancelBy: '2026-04-30',
      bookedOn: '2026-04-15',
      reference: 'HC-01',
      notes: 'Sit on the upper deck.',
      paidBy: ['payer-1'],
    };
    const tourDraft = buildTourDraftFromRow(tour as any);
    expect(tourDraft.reference).toBe('HC-01');
    expect(tourDraft.notes).toBe('Sit on the upper deck.');
    const rental = {
      id: 'car-1',
      pickupLocation: 'Airport',
      pickupDate: '2026-05-02',
      dropoffLocation: 'Hotel',
      dropoffDate: '2026-05-04',
      reference: 'CR-01',
      vendor: 'Hertz',
      prepaid: 'Yes',
      cost: '200',
      model: 'Sedan',
      notes: 'WiFi included',
      paidBy: ['payer-1'],
    };
    const rentalDraft = buildRentalDraftFromRow(rental as any);
    expect(rentalDraft.vendor).toBe('Hertz');
  });

  test('builds rows for each category in order', () => {
    const rows = buildOverviewRows({
      tripStartDate: '2025-04-10',
      tripMonthLabel: null,
      itineraryDetails: [{ id: 'i1', day: 1, time: '09:00', activity: 'Breakfast' }],
      flights: [
        {
          id: 'f1',
          departure_date: '2025-04-10',
          departure_time: '07:00',
          arrival_time: '09:00',
          carrier: 'Delta',
          flight_number: 'DL100',
          departure_airport_code: 'JFK',
          arrival_airport_code: 'LAX',
          booking_reference: 'ABC',
          cost: 200,
        },
      ],
      lodgings: [
        {
          id: 'l1',
          name: 'Hotel Test',
          checkInDate: '2025-04-10',
          checkOutDate: '2025-04-12',
          rooms: '1',
          refundBy: '',
          totalCost: '200',
          costPerNight: '100',
          address: 'Main St',
        },
      ],
      tours: [
        {
          id: 't1',
          name: 'City Tour',
          date: '2025-04-10',
          startTime: '11:00',
          startLocation: 'Downtown',
          duration: '2h',
          cost: '50',
          freeCancelBy: '',
          bookedOn: '',
          reference: 'REF',
        },
      ],
      rentals: [
        {
          id: 'r1',
          pickupLocation: 'Airport',
          pickupDate: '2025-04-10',
          dropoffLocation: 'Hotel',
          dropoffDate: '2025-04-12',
          vendor: 'Hertz',
          model: 'SUV',
        },
      ],
    });
    const types = rows.map((r) => r.type);
    expect(types).toEqual(['activity', 'flight', 'lodging', 'tour', 'rental', 'activity', 'rental']);
  });

  test('orders items within a category by time', () => {
    const rows = buildOverviewRows({
      tripStartDate: '2025-04-10',
      tripMonthLabel: null,
      itineraryDetails: [
        { id: 'i1', day: 1, time: '10:00', activity: 'Museum' },
        { id: 'i2', day: 1, time: '08:00', activity: 'Breakfast' },
      ],
      flights: [],
      lodgings: [],
      tours: [],
    });
    expect(rows[0].label).toBe('Breakfast');
    expect(rows[1].label).toBe('Museum');
  });

  test('uses month label when no start date', () => {
    const rows = buildOverviewRows({
      tripStartDate: null,
      tripMonthLabel: 'April 2025',
      itineraryDetails: [{ id: 'i1', day: 1, time: null, activity: 'Check-in' }],
      flights: [],
      lodgings: [],
      tours: [],
    });
    expect(rows[0].dateLabel).toBe('April 2025');
    expect(rows[0].dayLabel).toBe('Day 1');
  });
});

describe('Overview UI (nested itinerary)', () => {
  const styles: any = {
    sectionTitle: { fontSize: 18 },
    helperText: { fontSize: 12 },
    flightTitle: { fontSize: 16 },
    button: { padding: 8 },
    smallButton: { padding: 6 },
    dropdown: { backgroundColor: '#e5e7eb' },
    toggleActive: { backgroundColor: '#111827' },
    headerText: { fontSize: 14 },
    bodyText: { fontSize: 14 },
  };

  const baseProps = {
    backendUrl: 'http://localhost:4000',
    headers: {} as Record<string, string>,
    jsonHeaders: {} as Record<string, string>,
    trip: {
      id: 'trip1',
      groupId: 'g1',
      name: 'Test Trip',
      destination: 'Test City',
      startDate: '2026-01-29',
      endDate: '2026-01-30',
      startMonth: null,
      startYear: null,
      durationDays: null,
      createdAt: '2026-01-01',
    },
    group: null,
    attendees: [],
    flights: [] as any[],
    lodgings: [] as any[],
    tours: [] as any[],
    carRentals: [] as any[],
    defaultPayerId: null,
    styles,
    mapApp: 'apple' as any,
    onOpenAddress: jest.fn(),
    onRefreshTrips: jest.fn(),
    onRefreshGroups: jest.fn(),
    onRefreshGroupMembers: jest.fn(),
    onFlightDataChanged: jest.fn(),
    onLodgingDataChanged: jest.fn(),
    onTourDataChanged: jest.fn(),
    onAddCarRental: jest.fn(),
    openFlightInFlightsTab: jest.fn(),
    openLodgingDetails: jest.fn(),
  };
    
    let fetchMock: any;
    const originalFetch = global.fetch;  const renderOverview = async (element: React.ReactElement) => {
    const utils = render(element);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return utils;
  };

  beforeEach(() => {
    if (!global.fetch) {
      (global as any).fetch = jest.fn();
    }
    fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetchMock.mockRestore();
    if (!originalFetch) {
      delete (global as any).fetch;
    }
  });

  test('renders day pills with overview and short dates', async () => {
    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...baseProps} />);
    expect(await findByTestId('overview-day-pill-overview')).toBeTruthy();
    expect(await findByText('Thu. 29')).toBeTruthy();
    await findByTestId('overview-day-card-1');
  });

  // implementation-plan-ux-remediation.md Initiative B: a day hero card with
  // no resolved image falls back to the designed placeholder (flag on) or
  // the plain empty tile it replaced (flag off).
  test('falls back to the designed cover-photo placeholder when no day image resolves', async () => {
    const { findByTestId, queryByTestId } = await renderOverview(
      <OverviewTab {...baseProps} featureCoverPhotoFallbackV2 />
    );
    expect(await findByTestId('overview-day-card-1-placeholder')).toBeTruthy();
    expect(queryByTestId('overview-day-card-1-fallback-legacy')).toBeNull();
  });

  test('reverts to the plain fallback tile when featureCoverPhotoFallbackV2 is disabled', async () => {
    const { findByTestId, queryByTestId } = await renderOverview(
      <OverviewTab {...baseProps} featureCoverPhotoFallbackV2={false} />
    );
    expect(await findByTestId('overview-day-card-1-fallback-legacy')).toBeTruthy();
    expect(queryByTestId('overview-day-card-1-placeholder')).toBeNull();
  });

  test('shows the trip description on the overview page', async () => {
    const trip = {
      ...baseProps.trip,
      description: 'Hiking trip to Yosemite National Park',
    };

    const { findByText } = await renderOverview(<OverviewTab {...baseProps} trip={trip} />);

    expect(await findByText('Hiking trip to Yosemite National Park')).toBeTruthy();
  });

  test('uses an explicitly selected blog photo as the day hero image', async () => {
    const coverUrl = 'https://storage.example.com/blog-cover.jpg';
    fetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/trips/trip1/blog')) {
        return {
          ok: true,
          json: async () => ({
            days: [
              {
                localDate: '2026-01-29',
                coverItemId: 'asset-1',
                coverIsExplicit: true,
                items: [
                  {
                    kindKey: 'core.gallery',
                    assets: [{ id: 'asset-1', assetId: 'asset-1', mediaKind: 'photo', primaryUrl: coverUrl }],
                  },
                ],
              },
            ],
          }),
        } as any;
      }
      return { ok: true, json: async () => [] } as any;
    });

    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    const hero = await findByTestId('overview-day-card-1');
    await waitFor(async () => {
      const images = hero.findAllByType(Image);
      expect(images.some((image: any) => image.props.source?.uri === coverUrl)).toBe(true);
    });
  });

  test('keeps the full trip range even when events only exist on the first day', async () => {
    const flight = {
      id: 'flight-1',
      passenger_name: 'Traveler',
      passenger_ids: ['member-1'],
      trip_id: 'trip1',
      departure_date: '2026-01-29',
      departure_location: 'BOS',
      departure_airport_code: 'BOS',
      departure_time: '20:00',
      arrival_date: '2026-01-29',
      arrival_location: 'CAI',
      arrival_airport_code: 'CAI',
      arrival_time: '23:55',
      cost: 0,
      carrier: 'Delta',
      flight_number: 'DL100',
      booking_reference: 'ABC123',
    };

    const { findByTestId, findByText } = await renderOverview(
      <OverviewTab {...baseProps} flights={[flight] as any} />
    );

    expect(await findByText('Trip length: 2 day(s)')).toBeTruthy();
    expect(await findByTestId('overview-day-card-1')).toBeTruthy();
    expect(await findByTestId('overview-day-card-2')).toBeTruthy();
  });

  test('navigates to day details and back', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    const dayCard = await findByTestId('overview-day-card-1');
    fireEvent.press(dayCard);
    const back = await findByTestId('day-details-back');
    fireEvent.press(back);
    expect(await findByTestId('overview-day-card-1')).toBeTruthy();
  });

  test('shows the return transfer on the final day details', async () => {
    const trip = {
      ...baseProps.trip,
      startDate: '2026-05-15',
      endDate: '2026-05-22',
    };
    const attendees = [
      { id: 'member-1', firstName: 'Bryan', lastName: 'Duerk', email: 'bryan@example.com', status: 'active' as const },
      { id: 'member-2', firstName: 'Vicky', lastName: 'Duerk', email: 'vduerk@gmail.com', status: 'active' as const },
    ];
    const flights = [
      {
        id: 'flight-out',
        passenger_name: 'Bryan Duerk, vduerk@gmail.com',
        passenger_ids: [],
        trip_id: 'trip1',
        departure_date: '2026-05-15',
        departure_location: 'BOS',
        departure_airport_code: 'BOS',
        departure_time: '16:50',
        arrival_date: '2026-05-15',
        arrival_location: 'SFO',
        arrival_airport_code: 'SFO',
        arrival_time: '20:20',
        cost: 0,
        carrier: 'Flight',
        flight_number: '',
        booking_reference: '',
      },
      {
        id: 'flight-return',
        passenger_name: 'Bryan Duerk, vduerk@gmail.com',
        passenger_ids: [],
        trip_id: 'trip1',
        departure_date: '2026-05-22',
        departure_location: 'SFO',
        departure_airport_code: 'SFO',
        departure_time: '13:01',
        arrival_date: '2026-05-22',
        arrival_location: 'BOS',
        arrival_airport_code: 'BOS',
        arrival_time: '21:45',
        cost: 0,
        carrier: 'Flight',
        flight_number: '',
        booking_reference: '',
      },
    ];

    const { findByTestId, findByText } = await renderOverview(
      <OverviewTab {...baseProps} trip={trip as any} attendees={attendees} flights={flights as any} />
    );

    fireEvent.press(await findByTestId('overview-day-card-8'));
    expect(await findByText('SFO → BOS')).toBeTruthy();
    expect(await findByText('13:01 / 21:45')).toBeTruthy();
  });

  test('opens flight details modal from day details', async () => {
    const flight = {
      id: 'flight-1',
      passenger_name: 'Traveler',
      passenger_ids: ['member-1'],
      trip_id: 'trip1',
      departure_date: '2026-01-29',
      departure_location: 'BOS',
      departure_airport_code: 'BOS',
      departure_time: '20:00',
      arrival_date: '2026-01-30',
      arrival_location: 'CAI',
      arrival_airport_code: 'CAI',
      arrival_time: '19:55',
      cost: 0,
      carrier: 'Delta',
      flight_number: 'DL100',
      booking_reference: 'ABC123',
    };
    const attendees = [
      { id: 'member-1', firstName: 'Vicky', lastName: 'Duerk', email: 'vduerk@gmail.com' },
    ];
    const { findByTestId, findByText } = await renderOverview(
      <OverviewTab {...baseProps} attendees={attendees} flights={[flight] as any} />
    );
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-flight-details'));
    expect(await findByText('Transfer Details')).toBeTruthy();
  });

  test('shows next day button in day details', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByTestId('day-details-next')).toBeTruthy();
  });

  test('day details renders the Notes & Checklists section with the +Add item button', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByTestId('day-details-itinerary-items')).toBeTruthy();
    expect(await findByTestId('day-details-add-item-button')).toBeTruthy();
  });

  test('day details sorts activities by time, keeps them out of the narrative, and opens one activity detail', async () => {
    const tours = [
      {
        id: 'tour-1',
        date: '2026-01-29',
        name: 'Second',
        startLocation: 'Old Town',
        startTime: '14:00',
        duration: '2h',
        cost: '40',
        freeCancelBy: '',
        bookedOn: '',
        reference: 'SECOND-REF',
        notes: 'Bring comfortable walking shoes.',
        paidBy: [],
        travelerIds: [],
        status: 'Proposed',
        activityType: 'Tour',
      },
      {
        id: 'tour-2',
        date: '2026-01-29',
        name: 'Hike',
        startLocation: 'Trailhead',
        startTime: '09:00',
        duration: '3h',
        cost: '0',
        freeCancelBy: '',
        bookedOn: '',
        reference: 'HIKE-REF',
        notes: 'Test description',
        paidBy: [],
        travelerIds: [],
        status: 'Proposed',
        activityType: 'Hike',
      },
    ];
    const { findByTestId, findByText, queryByText, toJSON } = await renderOverview(<OverviewTab {...baseProps} tours={tours as any} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));

    const textOutput = JSON.stringify(toJSON());
    expect(textOutput.indexOf('day-details-activity-tour-2')).toBeLessThan(textOutput.indexOf('day-details-activity-tour-1'));
    expect(queryByText('Second at 14:00')).toBeNull();
    expect(queryByText('Hike at 09:00')).toBeNull();
    expect(await findByText('Bring comfortable walking shoes.')).toBeTruthy();
    expect(await findByText('Test description')).toBeTruthy();
    expect(queryByText('see details')).toBeNull();

    fireEvent.press(await findByTestId('day-details-activity-tour-2'));
    expect(await findByText('Activity Details')).toBeTruthy();
    expect(await findByText('HIKE-REF')).toBeTruthy();
    expect(queryByText('SECOND-REF')).toBeNull();
  });

  test('+Add item button opens the four-option popover', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-item-button'));
    expect(await findByTestId('add-item-popover')).toBeTruthy();
    expect(await findByTestId('add-item-option-place')).toBeTruthy();
    expect(await findByTestId('add-item-option-note')).toBeTruthy();
    expect(await findByTestId('add-item-option-checklist')).toBeTruthy();
    expect(await findByTestId('add-item-option-activity')).toBeTruthy();
  });

  test('custom activity add item opens the activity dialog and saves a real activity', async () => {
    const onTourDataChanged = jest.fn();
    const { findByTestId, getByPlaceholderText } = await renderOverview(
      <OverviewTab {...baseProps} onTourDataChanged={onTourDataChanged} />
    );
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-item-button'));
    fireEvent.press(await findByTestId('add-item-option-activity'));

    expect(await findByTestId('activity-form-modal')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('Activity name'), 'Custom walking tour');
    fireEvent.changeText(getByPlaceholderText('Description'), 'A relaxed orientation walk.');
    fireEvent.press(await findByTestId('activity-save'));

    await waitFor(() => expect(onTourDataChanged).toHaveBeenCalled());
    const activityCall = fetchMock.mock.calls.find((call: any[]) => call[0] === 'http://localhost:4000/api/activities');
    expect(activityCall).toBeTruthy();
    const payload = JSON.parse(String(activityCall?.[1]?.body ?? '{}'));
    expect(payload.name).toBe('Custom walking tour');
    expect(payload.date).toBe('2026-01-29');
    expect(payload.notes).toBe('A relaxed orientation walk.');
  });

  test('shows traveler names when flights differ', async () => {
    const flights = [
      {
        id: 'flight-1',
        passenger_name: 'Traveler',
        passenger_ids: ['member-1'],
        trip_id: 'trip1',
        departure_date: '2026-01-29',
        departure_location: 'BOS',
        departure_airport_code: 'BOS',
        departure_time: '20:00',
        arrival_date: '2026-01-29',
        arrival_location: 'CAI',
        arrival_airport_code: 'CAI',
        arrival_time: '19:55',
        cost: 0,
        carrier: 'Delta',
        flight_number: 'DL100',
        booking_reference: 'ABC123',
      },
      {
        id: 'flight-2',
        passenger_name: 'Traveler',
        passenger_ids: ['member-2'],
        trip_id: 'trip1',
        departure_date: '2026-01-29',
        departure_location: 'BOS',
        departure_airport_code: 'BOS',
        departure_time: '21:00',
        arrival_date: '2026-01-29',
        arrival_location: 'CAI',
        arrival_airport_code: 'CAI',
        arrival_time: '20:55',
        cost: 0,
        carrier: 'Delta',
        flight_number: 'DL200',
        booking_reference: 'DEF456',
      },
    ];
    const attendees = [
      { id: 'member-1', firstName: 'Vicky', lastName: 'Duerk', email: 'vduerk@gmail.com' },
      { id: 'member-2', firstName: 'Bryan', lastName: 'Duerk', email: 'bryan@example.com' },
    ];
    const { findByTestId, findByText } = await renderOverview(
      <OverviewTab {...baseProps} attendees={attendees} flights={flights as any} />
    );
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByText(/Travelers: Vicky Duerk/i)).toBeTruthy();
    expect(await findByText(/Travelers: Bryan Duerk/i)).toBeTruthy();
  });

  test('keeps saved trip dates as the overview range when events fall outside them', async () => {
    const staleTripProps = {
      ...baseProps,
      trip: {
        ...baseProps.trip,
        startDate: '2025-11-14',
        endDate: '2025-11-21',
      },
      tours: [
        {
          id: 'tour-1',
          date: '2026-03-03',
          name: 'Visit Museo Nacional de Antropologia',
          startLocation: "Lodging at 'Mexico City'",
          startTime: '09:00',
          duration: '2h',
          cost: '0',
          freeCancelBy: '',
          bookedOn: '',
          reference: '',
          paidBy: [],
        },
      ] as any[],
      lodgings: [
        {
          id: 'lodging-1',
          name: "Lodging at 'Mexico City'",
          checkInDate: '2026-03-03',
          checkOutDate: '2026-03-10',
          rooms: '1',
          refundBy: '',
          totalCost: '0',
          costPerNight: '0',
          address: 'Mexico City',
        },
      ] as any[],
    };

    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...staleTripProps} />);
    expect(await findByText(/Dates: .*November.*2025.*November.*2025/i)).toBeTruthy();
    expect(await findByText('Trip length: 8 day(s)')).toBeTruthy();
    expect(await findByTestId('overview-day-card-1')).toBeTruthy();
    expect(await findByTestId('overview-day-card-8')).toBeTruthy();
  });

  test('shows weather badges on overview cards when the trip starts within 7 days', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    fetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/itinerary/weather/overview')) {
        return {
          ok: true,
          json: async () => ({
            weather: [
              {
                date: startDate,
                icon: '☀',
                temperatureHighC: 22,
                description: 'Clear',
                resolvedLocation: 'Test City',
              },
              {
                date: endDate,
                icon: '🌧',
                temperatureHighC: 19,
                description: 'Rain',
                resolvedLocation: 'Test City',
              },
            ],
          }),
        } as any;
      }
      return {
        ok: true,
        json: async () => [],
      } as any;
    });

    const weatherTripProps = {
      ...baseProps,
      trip: {
        ...baseProps.trip,
        startDate,
        endDate,
      },
    };

    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...weatherTripProps} />);
    expect(await findByTestId('overview-day-card-1-weather')).toBeTruthy();
    expect(await findByText('☀ 72°F')).toBeTruthy();
  });

  test('shows weather badges in Celsius when the profile prefers Celsius', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    fetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/itinerary/weather/overview')) {
        return {
          ok: true,
          json: async () => ({
            weather: [
              {
                date: startDate,
                icon: '☀',
                temperatureHighC: 22,
                description: 'Clear',
                resolvedLocation: 'Test City',
              },
            ],
          }),
        } as any;
      }
      return {
        ok: true,
        json: async () => [],
      } as any;
    });

    const weatherTripProps = {
      ...baseProps,
      trip: {
        ...baseProps.trip,
        startDate,
        endDate,
      },
      temperatureUnit: 'celsius' as const,
    };

    const { findByText } = await renderOverview(<OverviewTab {...weatherTripProps} />);
    expect(await findByText('☀ 22°C')).toBeTruthy();
  });

  test('renders transfer rows for a followed-style trip payload', async () => {
    const followedTripProps = {
      ...baseProps,
      trip: {
        id: 'followed-trip-1',
        groupId: 'group-1',
        groupName: 'Group',
        name: 'Followed Romania',
        destination: 'Bucharest',
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        createdAt: '2026-08-01',
      },
      flights: [
        {
          id: 'flight-followed-1',
          passenger_name: 'Bryan Traveler',
          passenger_ids: ['member-1'],
          trip_id: 'followed-trip-1',
          departure_date: '2026-09-01',
          departure_location: 'MXP',
          departure_airport_code: 'MXP',
          departure_time: '08:00',
          arrival_date: '2026-09-01',
          arrival_location: 'OTP',
          arrival_airport_code: 'OTP',
          arrival_time: '11:00',
          cost: 124.58,
          carrier: 'Ryanair',
          flight_number: 'FR259',
          booking_reference: 'ABC123',
        },
      ] as any[],
    };

    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...followedTripProps} />);
    expect(await findByText(/MXP - Travel day/i)).toBeTruthy();
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByText(/MXP → OTP/i)).toBeTruthy();
  });
});
