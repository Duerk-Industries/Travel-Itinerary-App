/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import IncomingShareModal from '../components/IncomingShareModal';
import { useShareIntent } from 'expo-share-intent';

const styles = { button: {}, buttonText: {} };
const trips = [
  { id: 'trip-1', name: 'Japan Trip', startDate: '2026-08-01', endDate: '2026-08-10' },
  { id: 'trip-2', name: 'Italy Trip', startDate: '2026-09-01', endDate: '2026-09-10' },
];

const mockedUseShareIntent = useShareIntent as jest.Mock;

describe('IncomingShareModal', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = originalFetch;
  });

  it('renders nothing when there is no pending share', () => {
    mockedUseShareIntent.mockReturnValue({ hasShareIntent: false, shareIntent: {}, resetShareIntent: jest.fn() });
    const { toJSON } = render(
      <IncomingShareModal backendUrl="https://api.example.com" headers={{}} trips={trips} activeTripId="trip-1" styles={styles} />
    );
    expect(toJSON()).toBeNull();
  });

  it('shows a trip picker defaulting to the active trip when a share is pending', () => {
    mockedUseShareIntent.mockReturnValue({
      hasShareIntent: true,
      shareIntent: { files: [{ path: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg', size: 100 }], text: null },
      resetShareIntent: jest.fn(),
    });
    const { getByTestId } = render(
      <IncomingShareModal backendUrl="https://api.example.com" headers={{}} trips={trips} activeTripId="trip-2" styles={styles} />
    );
    expect(getByTestId('share-trip-trip-1')).toBeTruthy();
    expect(getByTestId('share-trip-trip-2')).toBeTruthy();
    expect(getByTestId('share-day-input').props.value).toBe('2026-09-01'); // clamped into trip-2's range
  });

  it('prefills the message from the share intent\'s text', () => {
    mockedUseShareIntent.mockReturnValue({
      hasShareIntent: true,
      shareIntent: { files: [{ path: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg', size: 100 }], text: 'Look at this!' },
      resetShareIntent: jest.fn(),
    });
    const { getByTestId } = render(
      <IncomingShareModal backendUrl="https://api.example.com" headers={{}} trips={trips} activeTripId="trip-1" styles={styles} />
    );
    expect(getByTestId('share-message-input').props.value).toBe('Look at this!');
  });

  it('cancel resets the share intent without uploading', () => {
    const resetShareIntent = jest.fn();
    mockedUseShareIntent.mockReturnValue({
      hasShareIntent: true,
      shareIntent: { files: [{ path: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg', size: 100 }], text: null },
      resetShareIntent,
    });
    const { getByTestId } = render(
      <IncomingShareModal backendUrl="https://api.example.com" headers={{}} trips={trips} activeTripId="trip-1" styles={styles} />
    );
    fireEvent.press(getByTestId('share-cancel'));
    expect(resetShareIntent).toHaveBeenCalled();
  });

  it('uploads a single shared item with the message as its caption', async () => {
    const resetShareIntent = jest.fn();
    mockedUseShareIntent.mockReturnValue({
      hasShareIntent: true,
      shareIntent: { files: [{ path: 'file:///a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg', size: 100 }], text: 'A caption' },
      resetShareIntent,
    });
    const calls: any[] = [];
    (global as any).fetch = jest.fn(async (url: string, options?: any) => {
      calls.push({ url, options });
      if (url.includes('/a.jpg') || url === 'file:///a.jpg') return { blob: async () => ({ size: 100 }) };
      if (url.includes('upload-init')) return { ok: true, status: 201, json: async () => ({ asset: { id: 'asset-1' }, uploadUrl: null }) };
      if (url.includes('/complete')) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const { getByTestId } = render(
      <IncomingShareModal backendUrl="https://api.example.com" headers={{}} trips={trips} activeTripId="trip-1" styles={styles} />
    );
    fireEvent.press(getByTestId('share-submit'));

    await waitFor(() => expect(resetShareIntent).toHaveBeenCalled());

    const initCall = calls.find((c) => c.url.includes('upload-init'));
    expect(initCall).toBeTruthy();
    const body = JSON.parse(initCall.options.body);
    expect(body.caption).toBe('A caption');
    expect(body.mediaKind).toBe('photo');
  });
});
