/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = { card: {}, sectionTitle: {}, button: {}, buttonText: {} };
const tripId = 'trip-1';
const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const blogBody = (sharedMapEnabled: boolean, photoLocationEnabled = false) => ({
  id: 'blog-1', tripId, title: 'Blog', subtitle: null, introduction: null, contentRevision: 1, sharedMapEnabled, photoLocationEnabled,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, updateVersion: 1, activities: [],
    items: [{ id: 'item-1', kindKey: 'core.text', body: 'A day worth reading', audience: 'travelers', updateVersion: 1 }] }],
});

const mount = (preview: Array<{ dayDate: string; points: Array<{ lat: number; lng: number }> }>) => {
  let enabled = false;
  let locations = false;
  const calls: string[] = [];
  (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
    if (url.includes('/blog/capabilities')) return jsonResponse({ features: {}, limits: {} });
    if (url.includes('/facts')) return jsonResponse({ facts: [] });
    if (url.includes('/blog/map-sharing-preview')) { calls.push('preview'); return jsonResponse({ days: preview }); }
    if (method === 'PATCH' && url.endsWith(`/api/trips/${tripId}/blog`)) {
      const patch = JSON.parse(String(init?.body));
      if (patch.photoLocationEnabled !== undefined) { locations = patch.photoLocationEnabled; calls.push(`locations:${locations}`); }
      else { enabled = patch.sharedMapEnabled; calls.push(`patch:${enabled}`); }
      return jsonResponse(blogBody(enabled, locations));
    }
    if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(enabled, locations));
    return jsonResponse({}, 404);
  });
  const screen = render(<TripBlogTab backendUrl="https://wanderbunnies.test" headers={{ Authorization: 'Bearer t' }} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />);
  return { screen, calls };
};

const openSettings = async (screen: ReturnType<typeof render>) => {
  fireEvent.press(await screen.findByText('Edit blog'));
  fireEvent.press(await screen.findByTestId('blog-tools-toggle'));
  return screen.findByTestId('blog-shared-map-settings');
};

describe('TripBlogTab — follower day maps setting', () => {
  it('is off by default and cannot be enabled before the owner has seen a preview', async () => {
    const { screen } = mount([{ dayDate: '2026-09-01', points: [{ lat: 48.86, lng: 2.29 }, { lat: 48.87, lng: 2.3 }] }]);
    await openSettings(screen);
    expect(screen.getByText('Follower day maps: Off')).toBeTruthy();
    expect(screen.queryByTestId('blog-shared-map-on')).toBeNull();
  });

  it('shows the preview, then enables sharing only on the explicit confirm', async () => {
    const { screen, calls } = mount([{ dayDate: '2026-09-01', points: [{ lat: 48.86, lng: 2.29 }, { lat: 48.87, lng: 2.3 }] }]);
    await openSettings(screen);
    fireEvent.press(screen.getByTestId('blog-shared-map-preview'));
    await screen.findByTestId('blog-shared-map-preview-result');
    expect(screen.getByText('2026-09-01 · 2 approximate areas')).toBeTruthy();
    expect(calls).toEqual(['preview']);
    fireEvent.press(screen.getByTestId('blog-shared-map-on'));
    await waitFor(() => expect(screen.getByText('Follower day maps: On')).toBeTruthy());
    expect(calls).toEqual(['preview', 'patch:true']);
    fireEvent.press(screen.getByTestId('blog-shared-map-off'));
    await waitFor(() => expect(screen.getByText('Follower day maps: Off')).toBeTruthy());
    expect(calls).toEqual(['preview', 'patch:true', 'patch:false']);
  });

  it('does not offer to share when no day would show a map', async () => {
    const { screen, calls } = mount([]);
    await openSettings(screen);
    fireEvent.press(screen.getByTestId('blog-shared-map-preview'));
    await screen.findByText(/followers would see none/);
    expect(screen.getByTestId('blog-shared-map-on').props.accessibilityState?.disabled ?? screen.getByTestId('blog-shared-map-on').props.disabled).toBeTruthy();
    fireEvent.press(screen.getByTestId('blog-shared-map-on'));
    expect(calls).toEqual(['preview']);
  });
});

describe('TripBlogTab — photo location setting', () => {
  it('is off by default, says it is not retroactive, and toggles on and off', async () => {
    const { screen, calls } = mount([]);
    await openSettings(screen);
    expect(screen.getByText('Keep photo locations: Off')).toBeTruthy();
    expect(screen.getByText(/Photos already added are not changed/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('blog-photo-location-toggle'));
    await waitFor(() => expect(screen.getByText('Keep photo locations: On')).toBeTruthy());
    expect(screen.getByText('Photos you add from now on will keep where they were taken.')).toBeTruthy();
    expect(screen.getByTestId('blog-photo-location-toggle').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('blog-photo-location-toggle'));
    await waitFor(() => expect(screen.getByText('Keep photo locations: Off')).toBeTruthy());
    expect(calls).toEqual(['locations:true', 'locations:false']);
  });
});
