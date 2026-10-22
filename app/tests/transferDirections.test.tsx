import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { buildTransferDirections } from '../utils/mapLinks';
import TransferDirections from '../components/TransferDirections';

describe('transfer route links', () => {
  const origin = 'Hotel A & Spa, Tokyo';
  const destination = 'Tokyo Station, 東京';
  it.each(['Bus', 'Train', 'Ferry', 'Public Transit'])('uses transit for %s with both endpoints in Google Maps', type => {
    const route = buildTransferDirections(origin, destination, type, 'google')!;
    const url = new URL(route.url);
    expect(url.searchParams.get('origin')).toBe(origin);
    expect(url.searchParams.get('destination')).toBe(destination);
    expect(url.searchParams.get('travelmode')).toBe('transit');
    expect(url.searchParams.get('api')).toBe('1');
  });
  it.each(['Other', 'Private', 'Private Transfer', 'Flight'])('defaults to driving for %s', type => {
    expect(new URL(buildTransferDirections(origin, destination, type)!.url).searchParams.get('travelmode')).toBe('driving');
  });
  it.each(['Bus', 'Train', 'Private'])('uses Apple Maps endpoints and the correct mode for %s', type => {
    const url = new URL(buildTransferDirections(origin, destination, type, 'apple')!.url);
    expect(url.origin).toBe('https://maps.apple.com');
    expect(url.searchParams.get('source')).toBe(origin);
    expect(url.searchParams.get('destination')).toBe(destination);
    expect(url.searchParams.get('mode')).toBe(type === 'Private' ? 'driving' : 'transit');
  });
  it('uses Waze destination navigation for driving, and a full Google route for transit', () => {
    const waze = buildTransferDirections(origin, destination, 'Private', 'waze')!;
    expect(waze.usesCurrentLocation).toBe(true);
    expect(new URL(waze.url).searchParams.get('q')).toBe(destination);
    const transit = buildTransferDirections(origin, destination, 'Train', 'waze')!;
    expect(transit.app).toBe('google');
    expect(transit.usesCurrentLocation).toBe(false);
    expect(new URL(transit.url).searchParams.get('origin')).toBe(origin);
    expect(transit.mode).toBe('transit');
  });
  it('requires both locations', () => {
    expect(buildTransferDirections(' ', destination, 'Bus')).toBeNull();
    expect(buildTransferDirections(origin, '', 'Other')).toBeNull();
  });
});

describe('transfer directions actions', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());
  it('opens the preferred app with the current text in both locations', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByTestId } = render(<TransferDirections origin="Hotel address" destination="Station address" transferType="Bus" mapApp="apple" styles={{}} />);
    fireEvent.press(getByTestId('transfer-directions'));
    const url = new URL(open.mock.calls[0][0]);
    expect(url.searchParams.get('source')).toBe('Hotel address');
    expect(url.searchParams.get('destination')).toBe('Station address');
    expect(url.searchParams.get('mode')).toBe('transit');
  });
  it('offers the full saved route as well as Waze navigation', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByTestId, getByText } = render(<TransferDirections origin="Hotel address" destination="Station address" transferType="Private" mapApp="waze" styles={{}} />);
    expect(getByText('Waze · from current location')).toBeTruthy();
    fireEvent.press(getByTestId('transfer-saved-route'));
    const url = new URL(open.mock.calls[0][0]);
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('origin')).toBe('Hotel address');
    expect(url.searchParams.get('destination')).toBe('Station address');
  });
});
