/** @jest-environment jsdom */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import PublicTripBlogPage from '../components/PublicTripBlogPage';
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../utils/backendUrl', () => ({ resolveBackendUrl: () => 'https://api.test' }));
it('renders only server-projected public maps and removes them after a visibility recheck', async () => {
  const originalFetch = global.fetch;
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  let sharing = true;
  global.fetch = jest.fn(async input => {
    const url = String(input);
    const body = url.endsWith('/maps') ? { days: sharing ? [{ dayDate: '2027-04-05', mapPoints: { precision: 'approximate', points: [{ lat: 48.86, lng: 2.29 }, { lat: 48.87, lng: 2.34 }] } }] : [] }
      : { title: 'Paris', days: [{ localDate: '2027-04-05', headline: 'Museum day', summary: '', items: [] }] };
    return { ok: !url.includes('engagement'), status: url.includes('engagement') ? 404 : 200, json: async () => body } as Response;
  });
  const screen = render(<PublicTripBlogPage username="ada" tripSlug="paris" />);
  try {
    await waitFor(() => expect(screen.getByTestId('public-map-2027-04-05')).toBeTruthy());
    expect(screen.getByText(/Approximate areas/)).toBeTruthy();
    sharing = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(screen.queryByTestId('public-map-2027-04-05')).toBeNull());
    expect(screen.getByText('Museum day')).toBeTruthy();
  } finally {
    screen.unmount(); global.fetch = originalFetch;
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
  }
});
