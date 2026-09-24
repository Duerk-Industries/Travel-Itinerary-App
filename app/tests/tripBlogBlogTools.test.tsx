/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = { card: {}, sectionTitle: {}, button: {}, buttonText: {} };
const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer t' };
const tripId = 'trip-1';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const blogBody = {
  id: 'blog-1', tripId, title: 'Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, updateVersion: 1, items: [], activities: [] }],
};

const mount = (readOnly: boolean, features: Record<string, boolean>) => {
  (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
    if (url.includes('/blog/capabilities')) return jsonResponse({ features, limits: {} });
    if (url.includes('/blog/days/') && url.includes('/facts')) return jsonResponse({ facts: [] });
    if ((init?.method ?? 'GET') === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody);
    return jsonResponse({}, 404);
  });
  return render(<TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={readOnly} />);
};

describe('TripBlogTab — "Blog tools" drawer visibility', () => {
  it('is hidden for a follower who has nothing in it', async () => {
    const screen = mount(true, {});
    await waitFor(() => expect(screen.queryByText('2026-09-01')).toBeTruthy());
    expect(screen.queryByTestId('blog-tools-toggle')).toBeNull();
  });

  it('shows for a traveler when at least the spend figure applies', async () => {
    const screen = mount(false, { trip_blog_spend_summary: true });
    await waitFor(() => expect(screen.getByTestId('blog-tools-toggle')).toBeTruthy());
  });
});
