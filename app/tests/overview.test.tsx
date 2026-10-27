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
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Image } from 'react-native';
import { OverviewTab, buildDayWeatherLocation, makeWeatherLocationGeofriendly } from '../tabs/overview';
import React from 'react';
import NearbyPlacesPanel from '../components/NearbyPlacesPanel';
import { localIsoDate } from '../utils/tripDayFocus';

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

  describe('opening day, whole-trip view and adding travelers', () => {
    const isoOffset = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return localIsoDate(d);
    };
    const underway = { ...baseProps, trip: { ...baseProps.trip, startDate: isoOffset(-1), endDate: isoOffset(1) } };

    test('opens on the overview when the trip is not under way', async () => {
      const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
      expect(await findByTestId('overview-day-card-1')).toBeTruthy();
      expect(queryByTestId('day-details-back')).toBeNull();
    });

    test('opens on today during the trip', async () => {
      const { findByTestId } = await renderOverview(<OverviewTab {...underway} />);
      expect(await findByTestId('day-details-back')).toBeTruthy();
    });

    test('the Whole trip pill lists every day, and a day opens its details', async () => {
      const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
      fireEvent.press(await findByTestId('overview-day-pill-whole-trip'));
      expect(await findByTestId('overview-whole-trip')).toBeTruthy();
      expect(queryByTestId('overview-day-card-1')).toBeNull();
      fireEvent.press(await findByTestId('overview-whole-trip-day-2'));
      expect(await findByTestId('day-details-back')).toBeTruthy();
    });

    test('the menu contains selectable actions, closes after selection, and dismisses outside', async () => {
      const onOpenShareTrip = jest.fn();
      const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} onOpenShareTrip={onOpenShareTrip} />);
      expect(queryByTestId('overview-actions-menu-panel')).toBeNull();
      expect(queryByTestId('itinerary-share-trip-button')).toBeNull();
      fireEvent.press(await findByTestId('overview-actions-menu'));
      const panel = await findByTestId('overview-actions-menu-panel');
      expect(panel.props.accessibilityRole).toBe('menu');
      const share = within(panel).getByTestId('itinerary-share-trip-button');
      expect(share.props.accessibilityRole).toBe('menuitem');
      fireEvent.press(share);
      expect(onOpenShareTrip).toHaveBeenCalledTimes(1);
      expect(queryByTestId('overview-actions-menu-panel')).toBeNull();
      fireEvent.press(await findByTestId('overview-actions-menu'));
      fireEvent.press(await findByTestId('overview-actions-menu-dismiss'));
      expect(queryByTestId('overview-actions-menu-panel')).toBeNull();
    });

    test('orders the trip menu actions with traveler actions first and print last', async () => {
      const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} onOpenShareTrip={jest.fn()} onGenerateAiItinerary={jest.fn()} />);
      fireEvent.press(await findByTestId('overview-actions-menu'));
      const menu = within(await findByTestId('overview-actions-menu-panel'));
      expect(menu.getAllByTestId(/^(overview-add-traveler|overview-edit|itinerary-share-trip-button|overview-generate-itinerary|overview-print-itinerary)$/).map((item) => item.props.testID)).toEqual([
        'overview-add-traveler', 'overview-edit', 'itinerary-share-trip-button',
        'overview-generate-itinerary', 'overview-print-itinerary',
      ]);
    });

    test('Generate itinerary asks first, then starts generation for the trip', async () => {
      const onGenerateAiItinerary = jest.fn();
      const { findByTestId, queryByTestId, getByText } = await renderOverview(<OverviewTab {...baseProps} onGenerateAiItinerary={onGenerateAiItinerary} />);
      fireEvent.press(await findByTestId('overview-actions-menu'));
      fireEvent.press(await findByTestId('overview-generate-itinerary'));
      expect(onGenerateAiItinerary).not.toHaveBeenCalled();
      fireEvent.press(getByText('Generate'));
      expect(onGenerateAiItinerary).toHaveBeenCalledWith('trip1');
      expect(queryByTestId('overview-generate-itinerary')).toBeNull(); // the menu closes once an action is chosen
    });

    test('Generate itinerary is hidden when unavailable, not allowed, read-only or already running', async () => {
      const fn = jest.fn();
      for (const props of [{}, { onGenerateAiItinerary: fn, aiItineraryGenerationAllowed: false }, { onGenerateAiItinerary: fn, readOnly: true }, { onGenerateAiItinerary: fn, aiItineraryPending: true }]) {
        const view = await renderOverview(<OverviewTab {...baseProps} {...(props as any)} />);
        fireEvent.press(await view.findByTestId('overview-actions-menu'));
        expect(view.queryByTestId('overview-generate-itinerary')).toBeNull();
        view.unmount();
      }
    });

    test('Notes are hidden when the trip has none', async () => {
      const { queryByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
      expect(queryByTestId('overview-trip-notes')).toBeNull();
    });

    test('Add traveler is available without entering Edit mode, and hidden when read-only', async () => {
      const { findByTestId, findAllByPlaceholderText, queryByTestId, unmount } = await renderOverview(<OverviewTab {...baseProps} />);
      fireEvent.press(await findByTestId('overview-actions-menu'));
      fireEvent.press(await findByTestId('overview-add-traveler'));
      expect((await findAllByPlaceholderText('First name')).length).toBeGreaterThan(0);
      unmount();
      const readOnly = await renderOverview(<OverviewTab {...baseProps} readOnly />);
      fireEvent.press(await readOnly.findByTestId('overview-actions-menu'));
      expect(readOnly.queryByTestId('overview-add-traveler')).toBeNull();
    });
  });

  test('hides What to book now when there are no Needs Booking entries', async () => {
    const { queryByTestId, queryByText } = await renderOverview(<OverviewTab {...baseProps} tours={[
      { id: 'needed', name: 'Needed activity', status: 'Proposed', date: '2026-01-29', startTime: '', cost: '0', paidBy: [] },
      { id: 'proposed', name: 'Proposed activity', status: 'Proposed', date: '2026-01-29', startTime: '', cost: '0', paidBy: [] },
    ] as any} />);
    expect(queryByTestId('overview-booking-priorities-card')).toBeNull();
    expect(queryByText('What to book now')).toBeNull();
  });

  test('shows only Needs Booking entries and hides the section after they are booked', async () => {
    const tours = [
      { id: 'ready', name: 'Ready activity', status: 'Needs Booking', date: '2026-01-29', startTime: '', cost: '0', paidBy: [] },
      { id: 'proposed', name: 'Proposed activity', status: 'Proposed', date: '2026-01-29', startTime: '', cost: '0', paidBy: [] },
    ];
    const { getByTestId, queryByTestId, rerender } = await renderOverview(<OverviewTab {...baseProps} tours={tours as any} />);
    expect(getByTestId('overview-booking-priorities-card')).toBeTruthy();
    expect(getByTestId('overview-booking-priority-activity-ready')).toBeTruthy();
    expect(queryByTestId('overview-booking-priority-activity-proposed')).toBeNull();
    rerender(<OverviewTab {...baseProps} tours={tours.map(tour => ({ ...tour, status: 'Booked' })) as any} />);
    expect(queryByTestId('overview-booking-priorities-card')).toBeNull();
  });

  test('shows Nearby only while the day map is shown and omits the duplicate transfer narrative', async () => {
    const flight = { id: 'route', trip_id: 'trip1', departure_date: '2026-01-29', arrival_date: '2026-01-29',
      departure_location: 'BOS', arrival_location: 'NRT', departure_time: '09:00', arrival_time: '18:00',
      carrier: 'Airline', flight_number: '1', cost: 0, booking_reference: '' };
    const view = await renderOverview(<OverviewTab {...baseProps} flights={[flight] as any} />);
    fireEvent.press(await view.findByTestId('overview-day-card-1'));
    const map = view.UNSAFE_root.findAll((node: { props: { testID?: string; onOpenChange?: unknown } }) => node.props.testID === 'day-detail-map' && Boolean(node.props.onOpenChange))[0];
    expect(map).toBeTruthy();
    fireEvent(map, 'openChange', false);
    expect(view.UNSAFE_root.findAllByType(NearbyPlacesPanel)).toHaveLength(0);
    fireEvent(map, 'openChange', true);
    expect(view.UNSAFE_root.findAllByType(NearbyPlacesPanel)).toHaveLength(1);
    fireEvent(map, 'openChange', false);
    expect(view.UNSAFE_root.findAllByType(NearbyPlacesPanel)).toHaveLength(0);
    expect(view.queryByText('Transfer from BOS to NRT.')).toBeNull();
    expect(view.getByText('Your transfer')).toBeTruthy();
  });

  test('renders day pills with overview and month-inclusive dates', async () => {
    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...baseProps} />);
    expect(await findByTestId('overview-day-pill-overview')).toBeTruthy();
    expect(await findByText('Thu. Jan. 29')).toBeTruthy();
    expect(await findByText('Day 1 - Thursday Jan. 29')).toBeTruthy();
    await findByTestId('overview-day-card-1');
  });

  test('renders a cached itinerary without requesting itinerary data while offline', async () => {
    const onItineraryCacheChange = jest.fn();
    const { findByText } = await renderOverview(
      <OverviewTab
        {...baseProps}
        cachedItinerary={{
          id: 'offline-itinerary',
          planMarkdown: 'Offline itinerary notes',
          details: [{ id: 'offline-detail', day: 1, time: '09:00', activity: 'Cached museum visit' }],
        }}
        onItineraryCacheChange={onItineraryCacheChange}
      />
    );

    expect(await findByText('Test City - Cached museum visit')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]: [unknown]) => String(url).includes('/api/itineraries'))).toBe(false);
    expect(onItineraryCacheChange).not.toHaveBeenCalled();
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
    fetchMock.mockImplementation(async (input: unknown) => ({
      ok: true,
      json: async () => String(input).includes('/locations?q=BOS') ? ['Boston (BOS)']
        : String(input).includes('/locations?q=CAI') ? ['Cairo (CAI)'] : [],
    }));
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
    fireEvent.press(await findByTestId(`day-details-transfer-${flight.id}`));
    expect(await findByTestId('flight-overview-details')).toBeTruthy();
    expect(await findByTestId('flight-details-edit')).toBeTruthy();
    expect(await findByText('Boston (BOS) → Cairo (CAI)')).toBeTruthy();
    expect(await findByText('Boston (BOS)')).toBeTruthy();
    expect(await findByText('Cairo (CAI)')).toBeTruthy();
  });

  test('opens only the selected ground transfer with directions without the dialog flag', async () => {
    const flights = [
      { id: 'air', trip_id: 'trip1', transfer_type: 'Flight', departure_date: '2026-01-29', departure_location: 'BOS', arrival_location: 'NRT', booking_reference: 'AIR123' },
      { id: 'ground', trip_id: 'trip1', transfer_type: 'Public Transit', departure_date: '2026-01-29', departure_location: 'Tokyo Station', arrival_location: 'Hotel address', booking_reference: 'GROUND456' },
    ];
    const { findByTestId, findByText, queryByText, queryByTestId } = await renderOverview(
      <OverviewTab {...baseProps} flights={flights as any} />
    );
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-transfer-ground'));
    expect(await findByTestId('flight-overview-details')).toBeTruthy();
    expect(await findByText('GROUND456')).toBeTruthy();
    expect(queryByText('AIR123')).toBeNull();
    expect(await findByTestId('flight-details-edit')).toBeTruthy();
    expect(await findByTestId('transfer-directions')).toBeTruthy();
    expect(await findByText('Public transport · Apple Maps')).toBeTruthy();
    fireEvent.press(await findByText('Close'));
    fireEvent.press(await findByTestId('day-details-transfer-air'));
    expect(await findByText('AIR123')).toBeTruthy();
    expect(queryByTestId('transfer-directions')).toBeNull();
  });

  test('shows next day button in day details', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByTestId('day-details-next')).toBeTruthy();
  });

  test('uses trip length for unscheduled days without displaying invented calendar dates', async () => {
    const { findAllByTestId, findByTestId, findByText } = await renderOverview(<OverviewTab {...baseProps}
      trip={{ ...baseProps.trip, startDate: null, endDate: null, startMonth: null, startYear: null, durationDays: 4 }} />);
    expect(await findAllByTestId(/^overview-day-card-\d+$/)).toHaveLength(4);
    fireEvent.press(await findByTestId('overview-day-card-4'));
    expect(await findByText('Day 4')).toBeTruthy();
    expect(await findByTestId('day-details-add-note-button')).toBeTruthy();
  });

  test('opens the picture chooser by pressing the day banner', async () => {
    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByText('Click to Change Picture')).toBeTruthy();
    fireEvent.press(await findByTestId('day-details-hero'));
    expect(await findByTestId('banner-upload-picture')).toBeTruthy();
  });

  test('hides empty Notes and Checklists and offers direct add buttons at the bottom', async () => {
    const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(queryByTestId('day-details-itinerary-items')).toBeNull();
    expect(queryByTestId('day-details-add-item-button')).toBeNull();
    expect(await findByTestId('day-details-add-note-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-checklist-button')).toBeTruthy();
    const actions = within(await findByTestId('day-details-add-actions'));
    expect(actions.getAllByTestId(/^day-details-add-.*-button$/).map((button) => button.props.testID)).toEqual([
      'day-details-add-flight-button', 'day-details-add-transfer-button', 'day-details-add-accommodation-button',
      'day-details-add-rental-button', 'day-details-add-activity-button', 'day-details-add-note-button', 'day-details-add-checklist-button',
    ]);
  });

  test('day with no items shows all "+ Add X" buttons grouped in one row', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(await findByTestId('day-details-add-flight-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-rental-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-activity-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-accommodation-button')).toBeTruthy();
  });

  test('keeps a single bottom flight action when a day already has transfers', async () => {
    const flights = [
      {
        id: 'flight-1',
        passenger_name: 'Traveler',
        passenger_ids: [],
        trip_id: 'trip1',
        departure_date: '2026-01-29',
        departure_location: 'BOS',
        departure_airport_code: 'BOS',
        departure_time: '08:00',
        arrival_date: '2026-01-29',
        arrival_location: 'SFO',
        arrival_airport_code: 'SFO',
        arrival_time: '11:00',
        cost: 0,
        carrier: 'Flight',
        flight_number: '',
        booking_reference: '',
      },
    ];
    const { findByTestId, findAllByTestId } = await renderOverview(
      <OverviewTab {...baseProps} flights={flights as any} />
    );
    fireEvent.press(await findByTestId('overview-day-card-1'));

    // Flight creation stays in the bottom row without an inline duplicate.
    expect(await findAllByTestId('day-details-add-flight-button')).toHaveLength(1);

    // The still-empty sections keep their buttons in the bottom row.
    expect(await findByTestId('day-details-add-rental-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-activity-button')).toBeTruthy();
    expect(await findByTestId('day-details-add-accommodation-button')).toBeTruthy();
  });

  test('+ Add flight opens the same flight editor used on the Transfers tab, seeded with the viewed day', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-flight-button'));
    expect(await findByTestId('flight-modal-departure-location')).toBeTruthy();
  });

  test('+ Add rental car opens a rental dialog seeded with the viewed day', async () => {
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-rental-button'));
    expect(await findByTestId('car-rental-form-modal')).toBeTruthy();
  });

  test('+ Add accommodation opens the same lodging dialog used on the Lodging tab', async () => {
    const { findByTestId, findByText } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-accommodation-button'));
    expect(await findByText('Add Lodging')).toBeTruthy();
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

  test('keeps existing locations and activities separate from notes and checklists', async () => {
    const { findByTestId, findAllByTestId } = await renderOverview(<OverviewTab {...baseProps}
      cachedItinerary={{ id: 'itinerary', planMarkdown: null, details: [
        { id: 'place', day: 1, kind: 'place', activity: 'Saved landmark', noteBody: 'Landmark details' },
        { id: 'legacy', day: 1, kind: 'activity', activity: 'Legacy walking tour' },
        { id: 'note', day: 1, kind: 'note', activity: 'Day reminder', noteBody: 'Bring water' },
        { id: 'list', day: 1, kind: 'checklist', activity: 'Packing reminder', checklistItems: [] },
      ] }} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    const locations = within(await findByTestId('day-details-locations-activities'));
    const notes = within(await findByTestId('day-details-itinerary-items'));
    expect(locations.getByText('Locations and Activities')).toBeTruthy();
    expect(locations.getByText('📍 Saved landmark')).toBeTruthy();
    expect(locations.getByText('Legacy walking tour')).toBeTruthy();
    expect(locations.queryByText('📝 Day reminder')).toBeNull();
    expect(notes.getByText('Notes and Checklists')).toBeTruthy();
    expect(notes.getByText('📝 Day reminder')).toBeTruthy();
    expect(notes.queryByText('📍 Saved landmark')).toBeNull();
    expect(await findAllByTestId('day-details-add-activity-button')).toHaveLength(1);
  });

  test.each(['note', 'checklist'])('Add %s opens its dialog directly and saves on the viewed day', async (kind) => {
    fetchMock.mockImplementation(async (input: unknown, init?: { method?: string }) => ({
      ok: true, json: async () => init?.method === 'POST' ? { id: 'new-item' } : [],
    }));
    const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps}
      cachedItinerary={{ id: 'itinerary-1', planMarkdown: null, details: [] }} />);
    fireEvent.press(await findByTestId('overview-day-card-2'));
    fireEvent.press(await findByTestId(`day-details-add-${kind}-button`));
    expect(queryByTestId('add-item-popover')).toBeNull();
    expect(await findByTestId(`${kind}-dialog`)).toBeTruthy();
    fireEvent.changeText(await findByTestId(`${kind}-dialog-title`), 'Remember tickets');
    fireEvent.changeText(await findByTestId(kind === 'note' ? 'note-dialog-body' : 'checklist-dialog-item-0'), 'Bring printed tickets');
    fireEvent.press(await findByTestId(`${kind}-dialog-submit`));
    await waitFor(() => expect(fetchMock.mock.calls.some((call: any[]) =>
      call[0] === 'http://localhost:4000/api/itineraries/itinerary-1/details' && call[1]?.method === 'POST')).toBe(true));
    const call = fetchMock.mock.calls.find((call: any[]) => call[0] === 'http://localhost:4000/api/itineraries/itinerary-1/details' && call[1]?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ day: 2, kind, activity: 'Remember tickets' });
  });

  test('Add transfer opens the ground transfer editor seeded with the viewed day', async () => {
    const { findByTestId, findByText, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} />);
    fireEvent.press(await findByTestId('overview-day-card-2'));
    fireEvent.press(await findByTestId('day-details-add-transfer-button'));
    expect(await findByText('Ground Transfer Details')).toBeTruthy();
    expect(await findByTestId('ground-departure-hotel')).toBeTruthy();
    expect(queryByTestId('flight-modal-flight-number')).toBeNull();
  });

  test('Add activity still offers a new activity when itinerary item kinds are disabled', async () => {
    const { findByTestId, queryByTestId } = await renderOverview(<OverviewTab {...baseProps} featureItineraryItemKinds={false} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    expect(queryByTestId('day-details-add-item-button')).toBeNull();
    expect(queryByTestId('day-details-add-note-button')).toBeNull();
    expect(queryByTestId('day-details-add-checklist-button')).toBeNull();
    fireEvent.press(await findByTestId('day-details-add-activity-button'));
    expect(await findByTestId('add-item-option-activity')).toBeTruthy();
    expect(queryByTestId('add-item-option-place')).toBeNull();
    expect(queryByTestId('add-item-option-note')).toBeNull();
    expect(queryByTestId('add-item-option-checklist')).toBeNull();
  });

  test.each([[1, '2026-01-29'], [2, '2026-01-30']])('defaults a new activity to viewed trip day %s', async (day, date) => {
    const onTourDataChanged = jest.fn();
    const { findByTestId, getByPlaceholderText } = await renderOverview(
      <OverviewTab {...baseProps} onTourDataChanged={onTourDataChanged} />
    );
    fireEvent.press(await findByTestId(`overview-day-card-${day}`));
    fireEvent.press(await findByTestId('day-details-add-activity-button'));
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
    expect(payload.date).toBe(date);
    expect(payload.notes).toBe('A relaxed orientation walk.');
  });

  test('creates an undated optional activity near a hotel from Add item', async () => {
    const onTourDataChanged = jest.fn();
    const { findByTestId, getByPlaceholderText } = await renderOverview(<OverviewTab {...baseProps}
      lodgings={[{ id: 'hotel', name: 'Central Hotel', checkInDate: '2026-01-29', checkOutDate: '2026-01-30' }] as any}
      onTourDataChanged={onTourDataChanged} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-activity-button'));
    fireEvent.press(await findByTestId('add-item-option-activity'));
    fireEvent.press(within(await findByTestId('activity-scheduling')).getByLabelText('Activity scheduling'));
    fireEvent.press(await findByTestId('activity-scheduling-option-optional'));
    fireEvent.changeText(getByPlaceholderText('Activity name'), 'Optional museum');
    fireEvent.press(within(await findByTestId('activity-near-hotel')).getByLabelText('Near hotel'));
    fireEvent.press(await findByTestId('activity-near-hotel-option-hotel'));
    fireEvent.press(await findByTestId('activity-save'));
    await waitFor(() => expect(onTourDataChanged).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((call: any[]) => call[0] === 'http://localhost:4000/api/activities');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ name: 'Optional museum', date: '', nearLodgingId: 'hotel' });
  });

  test('schedules an existing optional activity rather than creating a duplicate', async () => {
    const onTourDataChanged = jest.fn();
    const { findByTestId } = await renderOverview(<OverviewTab {...baseProps}
      tours={[{ id: 'option', name: 'Any-day museum', date: '', nearLodgingId: null, status: 'Proposed', cost: '0' }] as any}
      onTourDataChanged={onTourDataChanged} />);
    fireEvent.press(await findByTestId('overview-day-card-1'));
    fireEvent.press(await findByTestId('day-details-add-activity-button'));
    fireEvent.press(await findByTestId('add-item-optional-option'));
    await waitFor(() => expect(onTourDataChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/api/activities/option', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ date: '2026-01-29' }) }));
    expect(fetchMock.mock.calls.some((call: any[]) => call[0] === 'http://localhost:4000/api/activities' && call[1]?.method === 'POST')).toBe(false);
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
