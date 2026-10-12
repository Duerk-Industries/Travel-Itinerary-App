/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = { card: {}, sectionTitle: {}, button: {}, buttonText: {} };
const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer t' };
const tripId = 'trip-1';
const mergedStyle = (style: any) => Object.assign({}, ...(Array.isArray(style) ? style : [style]));

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const blogBody = {
  id: 'blog-1', tripId, title: 'Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, updateVersion: 1, activities: [],
    // Days with no posts are hidden outside edit mode, so the fixture day needs one to render.
    items: [{ id: 'item-1', kindKey: 'core.text', body: 'A day worth reading', audience: 'travelers', updateVersion: 1 }] }],
};

const mount = (readOnly: boolean, features: Record<string, boolean>, options: { theme?: any; blog?: any; facts?: any[] } = {}) => {
  (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
    if (url.includes('/blog/capabilities')) return jsonResponse({ features, limits: {} });
    if (url.includes('/blog/days/') && url.includes('/facts')) return jsonResponse({ facts: options.facts ?? [] });
    if ((init?.method ?? 'GET') === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(options.blog ?? blogBody);
    return jsonResponse({}, 404);
  });
  return render(<TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={options.theme ?? { colors: {} }} readOnly={readOnly} />);
};

describe('TripBlogTab — "Blog tools" drawer visibility', () => {
  it('places blog actions below the title at phone width', async () => {
    const native = require('react-native') as typeof import('react-native');
    const viewport = jest.spyOn(native, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
    try {
      const screen = mount(false, { trip_blog_keepsake_export: true });
      await waitFor(() => expect(screen.getByText('Edit blog')).toBeTruthy());
      expect(screen.getByTestId('blog-masthead-layout').props.style.flexDirection).toBe('column');
      expect(screen.getByTestId('blog-masthead-actions').props.style.flexWrap).toBe('wrap');
      expect(screen.getByText('Blog')).toBeTruthy();
    } finally {
      viewport.mockRestore();
    }
  });

  it('is hidden for a follower who has nothing in it', async () => {
    const screen = mount(true, {});
    await waitFor(() => expect(screen.queryByTestId('blog-day-2026-09-01')).toBeTruthy());
    expect(screen.queryByTestId('blog-tools-toggle')).toBeNull();
  });

  it('shows for a traveler when at least the spend figure applies', async () => {
    const screen = mount(false, { trip_blog_spend_summary: true });
    await waitFor(() => expect(screen.getByTestId('blog-tools-toggle')).toBeTruthy());
  });

  it('hides media counts, places, and planned comparisons when leaving edit mode', async () => {
    const publicBlog = { ...blogBody, visibilityState: 'public', days: blogBody.days.map((day) => ({ ...day, items: day.items.map((item) => ({ ...item, audience: 'public' })) })) };
    const facts = [
      { key: 'media', label: 'Photos & videos', value: '5 photos' },
      { key: 'places', label: 'Places', value: 'Bucharest' },
      { key: 'plannedVsActual', label: 'Planned vs. actual', value: '3 completed of 3 planned' },
      { key: 'weather', label: 'Weather', value: 'Sunny' },
    ];
    const screen = mount(false, {}, { blog: publicBlog, facts });
    fireEvent.press(await screen.findByText('Edit blog'));
    await waitFor(() => expect(screen.getByText('Places: Bucharest')).toBeTruthy());
    expect(screen.queryByText(/Photos & videos:/)).toBeNull();
    expect(screen.getByText('Planned vs. actual: 3 completed of 3 planned')).toBeTruthy();
    fireEvent.press(screen.getByText('Done editing'));
    await waitFor(() => expect(screen.queryByText('Places: Bucharest')).toBeNull());
    expect(screen.queryByText(/Planned vs\. actual:/)).toBeNull();
    expect(screen.getByTestId('blog-day-fact-2026-09-01-weather')).toBeTruthy();
  });

  it.each([
    ['light', '#111827', '#F2F5F7'],
    ['dark', '#E6ECEF', '#1C2B3A'],
  ])('uses readable edit-button text in %s mode', async (_mode, text, surfaceMuted) => {
    const screen = mount(false, {}, { theme: { colors: { text, surfaceMuted, cta: '#F59E0B' } } });
    const toggle = await screen.findByTestId('blog-edit-toggle');
    expect(mergedStyle(toggle.props.style).backgroundColor).toBe('#F59E0B');
    expect(mergedStyle(screen.getByText('Edit blog').props.style).color).toBe('#0B1726');
    fireEvent.press(toggle);
    await waitFor(() => expect(screen.getByText('Done editing')).toBeTruthy());
    expect(mergedStyle(screen.getByTestId('blog-edit-toggle').props.style).backgroundColor).toBe(surfaceMuted);
    expect(mergedStyle(screen.getByText('Done editing').props.style).color).toBe(text);
  });
});
