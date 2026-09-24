/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import TripBlogTab from '../tabs/tripBlog';
import { useAudioRecorder } from 'expo-audio';

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

const blogBody = {
  id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [{ id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, coverIsExplicit: false, items: [], activities: [] }],
};

describe('TripBlogTab in-app voice note recording', () => {
  let fetchMock: jest.Mock;
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  beforeEach(() => {
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
      uri: 'file:///recorded-voice-note.m4a',
    });
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('file:///')) return { ok: true, blob: async () => new Blob(['audio']) } as any;
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (url.includes('/blog/capabilities')) {
        return jsonResponse({ features: { trip_blog_audio: true, trip_blog_audio_transcription: true }, limits: {} });
      }
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody);
      if (method === 'POST' && url.includes('/blog/media/upload-init')) {
        return jsonResponse({ asset: { id: 'asset-new' } });
      }
      if (method === 'POST' && url.includes('/blog/media/asset-new/complete')) return jsonResponse({ ok: true });
      if (method === 'POST' && url.includes('/blog/media/asset-new/transcribe-caption')) {
        return jsonResponse({ caption: 'A quiet walk along the harbor.' });
      }
      if (method === 'PATCH' && url.includes('/blog/media/asset-new/metadata')) return jsonResponse({ ok: true });
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });
    (global as any).fetch = fetchMock;
  });

  const renderTab = () => render(
    <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />
  );

  it('records a voice note, uploads it, and saves the transcript as its caption -- no prerecorded file required', async () => {
    const { findByText, getByTestId } = renderTab();
    fireEvent.press(await findByText('Edit blog'));

    const recordButton = await waitFor(() => getByTestId('blog-record-voice-2026-09-01'));
    fireEvent.press(recordButton);
    await waitFor(() => expect(getByTestId('blog-record-voice-2026-09-01')).toBeTruthy());

    fireEvent.press(recordButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/upload-init`,
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-new/transcribe-caption`,
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-new/metadata`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ caption: 'A quiet walk along the harbor.', altText: '', isDecorative: false }),
      }),
    ));
  });

  // Regression test: manual testing on web (localhost:8081) surfaced "Saved, but couldn't
  // transcribe it: An audio recording is required" -- transcribeMediaCaption (tripBlog.tsx) was
  // reusing React Native's { uri, name, type } FormData file convention on every platform, but a
  // browser's FormData.append just stringifies that plain object instead of attaching real bytes,
  // so the server's multer middleware never received a file. Fixed by fetching the blob: URI into
  // a real Blob and appending that instead, only on web. This asserts the fix's actual mechanism:
  // on web, recording.uri gets fetched a SECOND time (once for the upload, once more here) to
  // build a real Blob for the transcribe request.
  it('fetches the recording a second time to build a real Blob for the transcribe request on web', async () => {
    Platform.OS = 'web';
    const { findByText, getByTestId } = renderTab();
    fireEvent.press(await findByText('Edit blog'));

    const recordButton = await waitFor(() => getByTestId('blog-record-voice-2026-09-01'));
    fireEvent.press(recordButton);
    await waitFor(() => expect(getByTestId('blog-record-voice-2026-09-01')).toBeTruthy());
    fireEvent.press(recordButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-new/transcribe-caption`,
      expect.objectContaining({ method: 'POST' }),
    ));
    const recordingUriFetches = fetchMock.mock.calls.filter(([reqUrl]: [string]) => String(reqUrl) === 'file:///recorded-voice-note.m4a');
    expect(recordingUriFetches).toHaveLength(2);
  });

  it('does not re-fetch the recording on native -- the { uri, name, type } FormData convention is used as before', async () => {
    Platform.OS = 'ios';
    const { findByText, getByTestId } = renderTab();
    fireEvent.press(await findByText('Edit blog'));

    const recordButton = await waitFor(() => getByTestId('blog-record-voice-2026-09-01'));
    fireEvent.press(recordButton);
    await waitFor(() => expect(getByTestId('blog-record-voice-2026-09-01')).toBeTruthy());
    fireEvent.press(recordButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/trips/${tripId}/blog/media/asset-new/transcribe-caption`,
      expect.objectContaining({ method: 'POST' }),
    ));
    const recordingUriFetches = fetchMock.mock.calls.filter(([reqUrl]: [string]) => String(reqUrl) === 'file:///recorded-voice-note.m4a');
    expect(recordingUriFetches).toHaveLength(1);
  });
});

describe('TripBlogTab voice note rendering', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  const renderWithAudioItem = (audioItem: any) => {
    const body = {
      id: 'blog-1', tripId, title: 'Test Blog', subtitle: null, introduction: null, contentRevision: 1,
      visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
      days: [{
        id: 'day-1', tripId, localDate: '2026-09-01', headline: null, summary: null, coverItemId: null, coverIsExplicit: false,
        items: [{ id: 'item-1', assetId: 'asset-1', kindKey: 'media.audio', mediaKind: 'audio', state: 'ready', ...audioItem }],
        activities: [],
      }],
    };
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (url.includes('/blog/capabilities')) return jsonResponse({ features: {}, limits: {} });
      if (url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(body);
      throw new Error(`Unhandled fetch: ${url}`);
    });
    return render(
      <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />
    );
  };

  // Regression test: manual testing found a real voice note (ready, with a transcript) still
  // showing "🎙 Voice note — processed, no preview available" and no way to play it back --
  // DayMediaGallery's photo mosaic forces every tile into a fixed-height cropped frame built for
  // images, which isn't a sensible layout for an <audio> element or a native "Play voice note"
  // button, and the fallback path for anything without a thumbnail used that confusing phrase
  // regardless of media kind. Voice notes are now rendered in their own dedicated block (transcript
  // first, playback control below), outside both the mosaic and that fallback text.
  it('shows the transcript and a real playback control for a ready voice note, never the old "no preview available" text', async () => {
    Platform.OS = 'web';
    const { findByTestId, getByText, queryByText } = renderWithAudioItem({
      primaryUrl: 'https://cdn.test/asset-1/source.m4a',
      caption: 'A quiet walk along the harbor.',
    });

    expect(await findByTestId('blog-voice-note-item-1')).toBeTruthy();
    expect(getByText('A quiet walk along the harbor.')).toBeTruthy();
    expect(await findByTestId('blog-media-audio-web')).toBeTruthy();
    expect(queryByText(/no preview available/i)).toBeNull();
  });

  it('shows an "Uploading…" state, not "no preview available", before the recording has a real URL yet', async () => {
    const { findByTestId, getByText, queryByText } = renderWithAudioItem({ primaryUrl: null, caption: null });

    expect(await findByTestId('blog-voice-note-item-1')).toBeTruthy();
    expect(getByText('Uploading…')).toBeTruthy();
    expect(queryByText(/no preview available/i)).toBeNull();
  });
});
