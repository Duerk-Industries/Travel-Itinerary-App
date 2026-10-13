/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = { card: {}, sectionTitle: {}, button: {}, buttonText: {} };
const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const tripId = 'trip-1';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

const blogBody = {
  id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, coverIsExplicit: false, items: [], activities: [] }],
};

// quickCapturePhoto (tripBlog.tsx) launches the device's own camera via expo-image-picker rather
// than a custom camera UI, then opens BlogMediaMetadataEditor's existing caption-dictation flow
// for the freshly uploaded asset — see the "fast way to take a picture and dictate a caption"
// request this was built for.
describe('TripBlogTab quick photo capture', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  const renderTab = (props: Partial<Parameters<typeof TripBlogTab>[0]> = {}) => render(
    <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} {...props} />
  );

  it('shows the camera quick-capture button outside edit mode, and hides it in edit mode', async () => {
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      return jsonResponse(blogBody);
    });

    const { findByTestId, getByText, queryByTestId } = renderTab();
    await findByTestId('blog-camera-capture');

    fireEvent.press(getByText('Edit blog'));
    await waitFor(() => expect(queryByTestId('blog-camera-capture')).toBeNull());
  });

  it('never shows the camera quick-capture button in a read-only view', async () => {
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      return jsonResponse(blogBody);
    });

    const { findByText, queryByTestId } = renderTab({ readOnly: true });
    await findByText('Traveler/follower view — all shared trip blog content is shown.');
    expect(queryByTestId('blog-camera-capture')).toBeNull();
  });

  it('captures a photo with the native camera, uploads it, and opens the caption editor for it', async () => {
    Platform.OS = 'ios';
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true, status: 'granted' });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://captured-photo.jpg', mimeType: 'image/jpeg', fileName: 'captured-photo.jpg', fileSize: 2048, exif: null }],
    });

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === 'file://captured-photo.jpg') {
        return { ok: true, blob: async () => new Blob(['photo-bytes'], { type: 'image/jpeg' }) } as any;
      }
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'POST' && url.includes('/blog/media/upload-init')) {
        return jsonResponse({ asset: { id: 'quick-asset-1', caption: null, altText: null, tags: [] }, uploadUrl: null }, 201);
      }
      if (method === 'POST' && url.includes('/blog/media/quick-asset-1/complete')) {
        return jsonResponse({ id: 'quick-asset-1' }, 200);
      }
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody);
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });
    (global as any).fetch = fetchMock;

    const { findByTestId, queryByTestId } = renderTab();
    fireEvent.press(await findByTestId('blog-camera-capture'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/blog/media/upload-init'),
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/blog/media/quick-asset-1/complete'),
      expect.objectContaining({ method: 'POST' }),
    ));

    // The caption modal opens automatically with the new asset, reusing the existing
    // dictate-a-caption editor — no need to enter edit mode or pick a day first.
    await findByTestId('blog-media-metadata-editor');

    fireEvent.press(await findByTestId('blog-quick-capture-done'));
    await waitFor(() => expect(queryByTestId('blog-media-metadata-editor')).toBeNull());
  });

  it('skips the permission/camera call on web (expo-image-picker handles permission itself there)', async () => {
    Platform.OS = 'web';
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      return jsonResponse(blogBody);
    });

    const { findByTestId } = renderTab();
    fireEvent.press(await findByTestId('blog-camera-capture'));

    await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalled());
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });
});
