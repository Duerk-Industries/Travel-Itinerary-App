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

const galleryItem = {
  id: 'gallery-item-1', tripId, kindKey: 'core.gallery', schemaVersion: 1, audience: 'public',
  sortKey: 'gallery-1', authorUserId: 'user-1', lastEditorUserId: 'user-1', version: 1,
  caption: null, dayDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  assets: [galleryAsset('asset-1', 0), galleryAsset('asset-2', 1), galleryAsset('asset-3', 2)],
};

const blogBody = {
  id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, items: [galleryItem], activities: [] }],
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

  it('renders a gallery item as a grid of thumbnails, not one post per photo', async () => {
    const { findByTestId } = renderTab();
    await findByTestId('gallery-thumb-asset-1');
    await findByTestId('gallery-thumb-asset-2');
    await findByTestId('gallery-thumb-asset-3');
  });

  it('opens the lightbox on tap and steps through photos with Prev/Next', async () => {
    const { findByTestId, getByTestId, queryByTestId } = renderTab();
    await findByTestId('gallery-thumb-asset-1');

    expect(queryByTestId('gallery-prev')).toBeNull();
    fireEvent.press(getByTestId('gallery-thumb-asset-1'));
    await waitFor(() => expect(getByTestId('gallery-next')).toBeTruthy());

    fireEvent.press(getByTestId('gallery-next'));
    fireEvent.press(getByTestId('gallery-lightbox-close'));
    await waitFor(() => expect(queryByTestId('gallery-prev')).toBeNull());
  });

  it('removes a single photo via the per-thumbnail control and reloads the blog', async () => {
    const { findByText, findByTestId } = renderTab();
    const initialBlogGetCalls = () => fetchMock.mock.calls.filter(([reqUrl, reqInit]: [string, RequestInit?]) =>
      String(reqUrl).includes(`/api/trips/${tripId}/blog?`) && (reqInit?.method ?? 'GET') === 'GET').length;

    // The remove overlay only renders in edit mode.
    fireEvent.press(await findByText('Edit blog'));
    const callsBeforeRemove = initialBlogGetCalls();
    const removeButton = await findByTestId('gallery-remove-asset-1');
    fireEvent.press(removeButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-1`,
      expect.objectContaining({ method: 'DELETE' }),
    ));
    // Removal triggers a fresh GET /blog to pick up the server's post-removal state.
    await waitFor(() => expect(initialBlogGetCalls()).toBeGreaterThan(callsBeforeRemove));
  });
});
