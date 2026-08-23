/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogDiscoveryPanel from '../components/BlogDiscoveryPanel';

describe('BlogDiscoveryPanel', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('loads plain search snippets and a derived places index lazily', async () => {
    global.fetch = jest.fn(async (url: any) => {
      if (String(url).includes('/search')) return { ok: true, json: async () => ({ results: [{ id: 'i1', localDate: '2027-04-02', snippet: 'Rainy market morning' }], nextCursor: null }) } as any;
      return { ok: true, json: async () => ({ places: [{ name: 'Pike Place Market', firstDate: '2027-04-02', occurrences: 2 }] }) } as any;
    }) as any;
    const view = render(<BlogDiscoveryPanel backendUrl="https://api.test" headers={{ Authorization: 'Bearer t' }} tripId="trip-1" searchEnabled placesEnabled />);
    fireEvent.changeText(view.getByTestId('blog-search-input'), 'market');
    fireEvent.press(view.getByTestId('blog-search-submit'));
    await waitFor(() => expect(view.getByText('Rainy market morning')).toBeTruthy());
    fireEvent.press(view.getByTestId('blog-load-places'));
    await waitFor(() => expect(view.getByText('Pike Place Market')).toBeTruthy());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('renders nothing when both independently releasable flags are off', () => {
    expect(render(<BlogDiscoveryPanel backendUrl="" headers={{}} tripId="trip-1" />).toJSON()).toBeNull();
  });
});
