/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TripDayMap from '../components/TripDayMap';
import type { TripMapPoint } from '../utils/googleMaps';

const BACKEND_URL = 'https://api.example.com';
const HEADERS = { Authorization: 'Bearer test-token' };

const POINTS: TripMapPoint[] = [
  { kind: 'flight', address: 'SFO' },
  { kind: 'lodging', address: 'Selina Puerto Viejo' },
];

describe('TripDayMap', () => {
  it('renders nothing when there are no points', () => {
    const { queryByTestId } = render(
      <TripDayMap points={[]} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(queryByTestId('day-detail-map')).toBeNull();
  });

  it('renders nothing when backendUrl is missing (feature not wired up yet)', () => {
    const { queryByTestId } = render(
      <TripDayMap points={POINTS} backendUrl="" requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(queryByTestId('day-detail-map')).toBeNull();
  });

  it('renders an authenticated Image against /api/maps/trip-day when points are present', () => {
    const { getByTestId, UNSAFE_getByType } = render(
      <TripDayMap points={POINTS} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(getByTestId('day-detail-map')).toBeTruthy();

    const { Image } = require('react-native');
    const image = UNSAFE_getByType(Image);
    expect(image.props.source?.uri).toContain(`${BACKEND_URL}/api/maps/trip-day?points=`);
    expect(image.props.source?.headers).toEqual(HEADERS);
  });

  it('collapses to nothing after the image fails to load (e.g. flag off, key missing, rate limited)', () => {
    const { getByTestId, queryByTestId, UNSAFE_getByType } = render(
      <TripDayMap points={POINTS} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(getByTestId('day-detail-map')).toBeTruthy();

    const { Image } = require('react-native');
    const image = UNSAFE_getByType(Image);
    fireEvent(image, 'error');

    expect(queryByTestId('day-detail-map')).toBeNull();
  });

  describe('on web (react-native-web silently drops <Image source.headers>)', () => {
    const { Platform } = require('react-native');
    const originalOS = Platform.OS;
    const originalFetch = global.fetch;

    // jsdom has no real createObjectURL/revokeObjectURL — stub them for the whole describe block
    // rather than restoring to "undefined" between tests, which would make the component's own
    // unmount-cleanup (revokeObjectURL) throw during React Testing Library's automatic cleanup.
    beforeAll(() => {
      (global as any).URL.createObjectURL = jest.fn(() => 'blob:fake-object-url');
      (global as any).URL.revokeObjectURL = jest.fn();
    });

    beforeEach(() => {
      Platform.OS = 'web';
    });

    afterEach(() => {
      Platform.OS = originalOS;
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    it('fetches the map with the Authorization header attached and renders a blob: object URL, not the raw backend URL', async () => {
      const fakeBlob = { size: 1 } as unknown as Blob;
      global.fetch = jest.fn(async () => ({ ok: true, blob: async () => fakeBlob })) as any;

      const { findByTestId, UNSAFE_getByType } = render(
        <TripDayMap points={POINTS} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
      );
      await findByTestId('day-detail-map');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`${BACKEND_URL}/api/maps/trip-day?points=`),
        { headers: HEADERS }
      );
      expect((global as any).URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);

      const { Image } = require('react-native');
      const image = UNSAFE_getByType(Image);
      expect(image.props.source?.uri).toBe('blob:fake-object-url');
      // The whole point of this workaround is that no header ever reaches the <Image> itself —
      // it's a same-origin blob: URL now, which needs none.
      expect(image.props.source?.headers).toBeUndefined();
    });

    it('renders nothing (not a broken image) when the authenticated fetch fails, e.g. a 401 from a dropped header', async () => {
      global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as any;

      const { queryByTestId } = render(
        <TripDayMap points={POINTS} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queryByTestId('day-detail-map')).toBeNull();
    });
  });

  it('shows a legend entry for each kind present, in flight/lodging/activity/car_rental order', () => {
    const { getByTestId, getByText, queryByText } = render(
      <TripDayMap points={POINTS} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(getByTestId('day-detail-map-legend')).toBeTruthy();
    expect(getByText('Flight')).toBeTruthy();
    expect(getByText('Lodging')).toBeTruthy();
    // Only kinds actually present in `points` should show up.
    expect(queryByText('Activity')).toBeNull();
    expect(queryByText('Car rental')).toBeNull();
  });

  it('does not duplicate a legend entry when a kind appears more than once', () => {
    const repeated = [
      { kind: 'car_rental' as const, address: 'Pickup' },
      { kind: 'car_rental' as const, address: 'Dropoff' },
    ];
    const { getAllByText } = render(
      <TripDayMap points={repeated} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(getAllByText('Car rental')).toHaveLength(1);
  });

  it('renders no legend when there are no points', () => {
    const { queryByTestId } = render(
      <TripDayMap points={[]} backendUrl={BACKEND_URL} requestHeaders={HEADERS} testID="day-detail-map" />
    );
    expect(queryByTestId('day-detail-map-legend')).toBeNull();
  });
});
