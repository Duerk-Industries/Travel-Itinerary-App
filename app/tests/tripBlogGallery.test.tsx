/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = {
  card: {},
  sectionTitle: {},
  button: {},
  buttonText: {},
};

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const tripId = 'trip-1';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

const galleryAsset = (id: string, position: number) => ({
  id, assetId: id, mediaKind: 'photo', kindKey: 'media.photo', state: 'ready',
  primaryUrl: `https://cdn.test/${id}/primary.jpg`, thumbnailUrl: `https://cdn.test/${id}/thumb.jpg`,
  position, dayDate: '2026-09-01', caption: null, altText: null,
});

// A core.gallery blog_item groups a batch of uploaded assets — see blogRoutes.ts. The client
// flattens `assets` back out into the same combined per-day set standalone media.* items use
// (DayMediaGallery/DayMediaLightbox), so a traveler sees one browsable day gallery regardless of
// which upload flow produced any given photo.
const galleryItem = {
  id: 'gallery-item-1', tripId, kindKey: 'core.gallery', schemaVersion: 1, audience: 'public',
  sortKey: 'gallery-1', authorUserId: 'user-1', lastEditorUserId: 'user-1', version: 1,
  caption: null, dayDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  assets: [galleryAsset('asset-1', 0), galleryAsset('asset-2', 1), galleryAsset('asset-3', 2)],
};

const blogBody = {
  id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: 'asset-1', coverIsExplicit: false, items: [galleryItem], activities: [{ id: 'activity-1', name: 'Rainier hike', activityType: 'Hike', date: '2026-09-01', startTime: null, duration: null, status: null, startLocation: null, notes: null }] }],
};

describe('TripBlogTab gallery rendering', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody);
      if (method === 'DELETE' && url.includes('/blog/media/asset-1')) return jsonResponse({}, 204);
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });
    (global as any).fetch = fetchMock;
  });

  const renderTab = () => render(
    <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />
  );

  it('flattens a gallery item into the combined day view: every asset shown as its own mosaic tile', async () => {
    const { findByTestId } = renderTab();
    // The gallery's three assets are combined into one browsable day mosaic, not rendered as
    // three separate posts, and not hidden one-at-a-time behind prev/next arrows.
    await findByTestId('day-media-grid-tile-asset-1');
    expect(await findByTestId('day-media-grid-tile-asset-2')).toBeTruthy();
    expect(await findByTestId('day-media-grid-tile-asset-3')).toBeTruthy();
  });

  it('shows linked activities in the authenticated traveler/follower read-only view', async () => {
    const { findByText } = render(
      <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly />
    );

    expect(await findByText('Rainier hike')).toBeTruthy();
    expect(await findByText('Traveler/follower view — all shared trip blog content is shown.')).toBeTruthy();
  });

  it('hides linked activities from a fully public read-only preview', async () => {
    const publicBlog = {
      ...blogBody,
      visibilityState: 'public',
      days: blogBody.days.map((day) => ({ ...day, items: [{ ...galleryItem, audience: 'travelers' }] })),
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(publicBlog);
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { queryByText, findByText } = render(
      <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly />
    );

    expect(await findByText('Public preview — only content intended for public sharing is shown.')).toBeTruthy();
    await waitFor(() => expect(queryByText('Rainier hike')).toBeNull());
    expect(queryByText('Planned activities')).toBeNull();
  });

  it('opens the tiled lightbox on tap and shows every gallery asset as its own tile', async () => {
    const { findByTestId, getByTestId } = renderTab();
    await findByTestId('day-media-grid-tile-asset-1');
    fireEvent.press(getByTestId('day-media-grid-tile-asset-1'));

    await waitFor(() => expect(getByTestId('day-media-tile-asset-1')).toBeTruthy());
    expect(getByTestId('day-media-tile-asset-2')).toBeTruthy();
    expect(getByTestId('day-media-tile-asset-3')).toBeTruthy();
  });

  it('removes a single gallery photo via the per-asset endpoint, not the whole-gallery endpoint', async () => {
    const { findByText, findByTestId } = renderTab();
    const blogGetCalls = () => fetchMock.mock.calls.filter(([reqUrl, reqInit]: [string, RequestInit?]) =>
      String(reqUrl).includes(`/api/trips/${tripId}/blog?`) && (reqInit?.method ?? 'GET') === 'GET').length;

    // The remove control only renders in edit mode.
    fireEvent.press(await findByText('Edit blog'));
    const callsBeforeRemove = blogGetCalls();
    const removeButton = await findByTestId('day-media-remove-asset-1');
    fireEvent.press(removeButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-1`,
      expect.objectContaining({ method: 'DELETE' }),
    ));
    // A gallery-member removal must never hit the whole-item endpoint (that would delete the
    // entire gallery, taking the other two photos with it).
    expect(fetchMock).not.toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/items/gallery-item-1`,
      expect.anything(),
    );
    // Removal triggers a fresh GET /blog to pick up the server's post-removal state.
    await waitFor(() => expect(blogGetCalls()).toBeGreaterThan(callsBeforeRemove));
  });
});
