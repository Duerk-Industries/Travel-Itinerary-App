/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import TripMap from '../components/TripMap';
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { nativeMapRenderer: true } } } }));
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = require('react-native');
  return { MapView: View, Camera: View, ShapeSource: View, CircleLayer: View, SymbolLayer: View, LineLayer: View };
});
const points = [{ id: 'one', kind: 'activity' as const, title: 'Museum', lat: 48.86, lng: 2.34, coordinateSource: 'manual' as const }];
it('keeps list fallback when rollout is off and loads native rendering only on demand', async () => {
  const screen = render(<TripMap points={points} />);
  fireEvent.press(screen.getByText('Show map'));
  expect(screen.getByText('1 · Museum')).toBeTruthy();
  expect(screen.queryByTestId('native-trip-map')).toBeNull();
  screen.rerender(<TripMap points={points} nativeEnabled />);
  await waitFor(() => expect(screen.getByTestId('native-trip-map')).toBeTruthy());
  fireEvent(screen.getByTestId('native-trip-map'), 'didFailLoadingMap');
  expect(screen.queryByTestId('native-trip-map')).toBeNull();
  expect(screen.getByText(/Map unavailable/)).toBeTruthy();
});
it('releases native map while backgrounded, restores on resume and cleans up listener', async () => {
  const screen = render(<TripMap points={points} nativeEnabled />);
  fireEvent.press(screen.getByText('Show map'));
  await waitFor(() => expect(screen.getByTestId('native-trip-map')).toBeTruthy());
  const mock = jest.mocked(AppState.addEventListener).mock;
  const listener = mock.calls[mock.calls.length - 1][1];
  const subscription = mock.results[mock.results.length - 1].value;
  act(() => listener('background'));
  expect(screen.queryByTestId('native-trip-map')).toBeNull();
  act(() => listener('active'));
  await waitFor(() => expect(screen.getByTestId('native-trip-map')).toBeTruthy());
  screen.unmount(); expect(subscription.remove).toHaveBeenCalled();
});

it('displays reviewed coordinate-provider attribution once, including list fallback', () => {
  const attributed = points.map(point => ({ ...point, coordinateAttribution: 'Reviewed POI provider', coordinateProvider: 'provider-policy-v1' }));
  const screen = render(<TripMap points={[...attributed, { ...attributed[0], id: 'two' }]} />);
  fireEvent.press(screen.getByText('Show map'));
  expect(screen.getAllByText('Reviewed POI provider')).toHaveLength(1);
});
