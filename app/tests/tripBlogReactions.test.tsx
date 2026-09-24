/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

// Phase 3 — end-to-end wiring of BlogReactionBar/useBlogEngagement through the real TripBlogTab
// component tree: day-level reactions, item-level reactions, and the gallery reaction badge.
const styles: Record<string, any> = { card: {}, sectionTitle: {}, button: {}, buttonText: {} };
const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const tripId = 'trip-1';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const galleryAsset = (id: string) => ({
  id, assetId: id, mediaKind: 'photo', kindKey: 'media.photo', state: 'ready',
  primaryUrl: `https://cdn.test/${id}/primary.jpg`, thumbnailUrl: `https://cdn.test/${id}/thumb.jpg`,
  position: 0, dayDate: '2026-09-01', caption: null, altText: null,
  engagement: { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null },
});

const blogBody = (dayEngagement: any, itemEngagement: any) => ({
  id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{
    id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null,
    coverItemId: 'asset-1', coverIsExplicit: false, updateVersion: 1,
    engagement: dayEngagement,
    contributors: [{ userId: 'user-1', displayName: 'Maya', itemCount: 1, assetCount: 1 }],
    items: [
      { id: 'item-1', kindKey: 'core.text', schemaVersion: 1, audience: 'public', sortKey: 'a', authorUserId: 'user-1', lastEditorUserId: 'user-1', version: 1, body: 'A note', languageTag: null, createdAt: '', updatedAt: '', engagement: itemEngagement },
      {
        id: 'gallery-item-1', tripId, kindKey: 'core.gallery', schemaVersion: 1, audience: 'public',
        sortKey: 'gallery-1', authorUserId: 'user-1', lastEditorUserId: 'user-1', version: 1,
        caption: null, dayDate: '2026-09-01', createdAt: '', updatedAt: '',
        assets: [galleryAsset('asset-1')],
      },
    ],
    activities: [],
  }],
});

describe('TripBlogTab — reaction wiring (day, item, gallery)', () => {
  const renderTab = () => render(
    <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />
  );

  it('reacting to a day sends a PUT and reflects the server summary optimistically then authoritatively', async () => {
    const zero = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
    let patchedEmoji: string | null = null;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(zero, zero));
      if (method === 'PUT' && url.endsWith('/blog/day/day-1/reactions')) {
        patchedEmoji = JSON.parse(String(init?.body)).emoji;
        return jsonResponse({ reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' });
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByTestId } = renderTab();
    const addButton = await findByTestId('blog-day-reactions-2026-09-01-add');
    await act(async () => { fireEvent.press(addButton); });
    const heartPick = await findByTestId('blog-day-reactions-2026-09-01-pick-heart');
    await act(async () => { fireEvent.press(heartPick); });

    await waitFor(() => expect(patchedEmoji).toBe('heart'));
    const chip = await findByTestId('blog-day-reactions-2026-09-01-chip-heart');
    expect(chip).toBeTruthy();
  });

  it('reacting to a text item sends a PUT scoped to the item target', async () => {
    const zero = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
    let requestedPath = '';
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(zero, zero));
      if (method === 'PUT' && url.includes('/reactions')) {
        requestedPath = url;
        return jsonResponse({ reactionCounts: { fire: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'fire' });
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByTestId } = renderTab();
    const addButton = await findByTestId('blog-item-reactions-item-1-add');
    await act(async () => { fireEvent.press(addButton); });
    const firePick = await findByTestId('blog-item-reactions-item-1-pick-fire');
    await act(async () => { fireEvent.press(firePick); });

    await waitFor(() => expect(requestedPath).toContain('/blog/item/item-1/reactions'));
  });

  it('a photo already carrying reaction counts on load renders its chip without any interaction', async () => {
    const zero = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) {
        const body = blogBody(zero, zero);
        (body.days[0].items[1] as any).assets[0].engagement = { reactionCounts: { heart: 4 }, reactionTotal: 4, commentCount: 0, userReaction: null };
        return jsonResponse(body);
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByTestId } = renderTab();
    const chip = await findByTestId('day-media-reactions-asset-1-chip-heart');
    expect(chip).toBeTruthy();
  });
});
