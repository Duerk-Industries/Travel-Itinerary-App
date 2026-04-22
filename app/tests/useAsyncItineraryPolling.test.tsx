/**
 * @jest-environment node
 */

import React, { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AsyncItineraryTracker, useAsyncItineraryPolling } from '../hooks/useAsyncItineraryPolling';

type HarnessProps = {
  backendUrl?: string;
  headers?: Record<string, string>;
  initialTrackers: Record<string, AsyncItineraryTracker>;
  pollIntervalMs?: number;
  refreshPageData?: () => Promise<unknown>;
  userToken?: string | null;
};

function usePollingHarness({
  backendUrl = 'https://wanderbunnies.test',
  headers = { Authorization: 'Bearer test-token' },
  initialTrackers,
  pollIntervalMs = 5000,
  refreshPageData = async () => undefined,
  userToken = 'test-token',
}: HarnessProps) {
  const [trackers, setTrackers] = useState(initialTrackers);

  useAsyncItineraryPolling({
    asyncItineraryByTrip: trackers,
    backendUrl,
    headers,
    pollIntervalMs,
    refreshPageData,
    setAsyncItineraryByTrip: setTrackers,
    userToken,
  });

  return { trackers, setTrackers };
}

const createJsonResponse = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: async () => body,
  } as Response);

describe('useAsyncItineraryPolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('removes completed jobs and refreshes page data once', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const refreshPageData = jest.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(() => createJsonResponse({ status: 'completed' }));

    const { result } = renderHook(() =>
      usePollingHarness({
        initialTrackers: {
          tripA: { jobId: 'job-1', status: 'pending' },
        },
        refreshPageData,
        pollIntervalMs: 5000,
      })
    );

    await waitFor(() => {
      expect(result.current.trackers).toEqual({});
    });
    expect(refreshPageData).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains failed jobs with the returned error message', async () => {
    const fetchMock = global.fetch as jest.Mock;

    fetchMock.mockImplementation(() => createJsonResponse({ status: 'failed', error: 'model overloaded' }));

    const { result } = renderHook(() =>
      usePollingHarness({
        initialTrackers: {
          tripA: { jobId: 'job-2', status: 'pending' },
        },
      })
    );

    await waitFor(() => {
      expect(result.current.trackers).toEqual({
        tripA: { jobId: 'job-2', status: 'failed', error: 'model overloaded' },
      });
    });
  });

  it('suppresses overlapping polls while a request is still in flight', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const refreshPageData = jest.fn().mockResolvedValue(undefined);
    let resolveFetch: ((value: Response) => void) | null = null;

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const { result } = renderHook(() =>
      usePollingHarness({
        initialTrackers: {
          tripA: { jobId: 'job-3', status: 'pending' },
        },
        refreshPageData,
        pollIntervalMs: 1000,
      })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed' }),
      } as Response);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.trackers).toEqual({});
    });
    expect(refreshPageData).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
