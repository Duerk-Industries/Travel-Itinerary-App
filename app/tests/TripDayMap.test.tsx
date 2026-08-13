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
});
