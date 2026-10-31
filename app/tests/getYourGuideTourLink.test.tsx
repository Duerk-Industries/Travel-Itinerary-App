/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking, Platform, Text } from 'react-native';
import GetYourGuideTourLink from '../components/GetYourGuideTourLink';
import { canBookTour, useGetYourGuideTourLinks } from '../hooks/useGetYourGuideTourLinks';
import { GETYOURGUIDE_DISCLOSURE_TEXT } from '../utils/getYourGuideLinks';

const link = { tourId: 't1', title: 'Rio tour', path: '/api/affiliate/getyourguide/tours/t1' };

describe('GetYourGuideTourLink', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('opens the tour through the server, with the disclosure', () => {
    Platform.OS = 'ios';
    const openURL = jest.fn().mockResolvedValue(undefined);
    (Linking as any).openURL = openURL;
    const { getByTestId, getByText } = render(<GetYourGuideTourLink backendUrl="https://api.test/" link={link} activityName="Sugarloaf" testID="tour" />);
    expect(getByText(GETYOURGUIDE_DISCLOSURE_TEXT)).toBeTruthy();
    fireEvent.press(getByTestId('tour-link'));
    expect(openURL).toHaveBeenCalledWith('https://api.test/api/affiliate/getyourguide/tours/t1');
  });

  it('leaves the disclosure to a list that shows it once', () => {
    const { queryByText } = render(<GetYourGuideTourLink backendUrl="" link={link} activityName="Sugarloaf" hideDisclosure />);
    expect(queryByText(GETYOURGUIDE_DISCLOSURE_TEXT)).toBeNull();
  });
});

describe('canBookTour', () => {
  it('is true while the activity can still be booked', () => {
    expect(canBookTour('Proposed')).toBe(true);
    expect(canBookTour('Needs Booking')).toBe(true);
    expect(canBookTour('Booked')).toBe(false);
    expect(canBookTour('Completed')).toBe(false);
    expect(canBookTour('Cancelled')).toBe(false);
  });
});

describe('useGetYourGuideTourLinks', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const headers = {};
  const Probe = (props: { tripId?: string | null; enabled?: boolean }) => {
    const links = useGetYourGuideTourLinks({ backendUrl: 'https://api.test', headers, refreshKey: 'x', ...props });
    return <Text testID="count">{Object.keys(links).length}</Text>;
  };

  it('loads the links for a trip', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ links: { a1: link } }) }) as any;
    const { getByTestId } = render(<Probe tripId="trip 1" />);
    await waitFor(() => expect(getByTestId('count').props.children).toBe(1));
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/api/affiliate/getyourguide/trips/trip%201/tours', { headers });
  });

  it('asks for nothing when turned off or without a trip, and stays empty on failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    render(<Probe tripId="t" enabled={false} />);
    render(<Probe tripId={null} />);
    expect(global.fetch).not.toHaveBeenCalled();
    const { getByTestId } = render(<Probe tripId="t" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getByTestId('count').props.children).toBe(0);
  });
});
