/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React, { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  useWindowDimensions: () => ({ width: 800, height: 600 }),
  useColorScheme: () => 'light',
}));

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

  it('marks completed jobs as completed (with itineraryId) and refreshes page data once', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const refreshPageData = jest.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation(() => createJsonResponse({ status: 'completed', itineraryId: 'itin-1' }));

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
      expect(result.current.trackers).toEqual({
        tripA: {
          jobId: 'job-1',
          status: 'completed',
          itineraryId: 'itin-1',
          error: undefined,
          stage: null,
          stageLabel: null,
          stageDetail: null,
          etaSeconds: null,
        },
      });
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
        tripA: {
          jobId: 'job-2',
          status: 'failed',
          error: 'model overloaded',
          stage: null,
          stageLabel: null,
          stageDetail: null,
          etaSeconds: null,
        },
      });
    });
  });

  it('keeps polling across multiple unchanged-status ticks before detecting completion', async () => {
    // Regression test: stillPending/completedCount must be derived from a synchronous
    // snapshot, not read back out of a setState updater's closure immediately after
    // calling it — that updater isn't guaranteed to run synchronously, and reading the
    // closure variable too early silently reported "done" after the very first tick
    // whenever the status hadn't changed, stopping polling forever.
    const fetchMock = global.fetch as jest.Mock;
    const refreshPageData = jest.fn().mockResolvedValue(undefined);
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount += 1;
      if (callCount < 3) return createJsonResponse({ status: 'pending' });
      return createJsonResponse({ status: 'completed', itineraryId: 'itin-4' });
    });

    const { result } = renderHook(() =>
      usePollingHarness({
        initialTrackers: { tripA: { jobId: 'job-4', status: 'pending' } },
        refreshPageData,
        pollIntervalMs: 1000,
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.trackers.tripA.status).toBe('pending');

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.trackers.tripA.status).toBe('pending');

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => {
      expect(result.current.trackers).toEqual({
        tripA: {
          jobId: 'job-4',
          status: 'completed',
          itineraryId: 'itin-4',
          error: undefined,
          stage: null,
          stageLabel: null,
          stageDetail: null,
          etaSeconds: null,
        },
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refreshPageData).toHaveBeenCalledTimes(1);
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
        json: async () => ({ status: 'completed', itineraryId: 'itin-3' }),
      } as Response);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.trackers).toEqual({
        tripA: {
          jobId: 'job-3',
          status: 'completed',
          itineraryId: 'itin-3',
          error: undefined,
          stage: null,
          stageLabel: null,
          stageDetail: null,
          etaSeconds: null,
        },
      });
    });
    expect(refreshPageData).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces stage/label/detail/eta while still pending', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(() =>
      createJsonResponse({
        status: 'running',
        stage: 'days',
        stageLabel: 'Phase 3 of 6: Building day-by-day activities',
        stageDetail: 'Choosing attractions, tours, and pacing for each day of the trip.',
        etaSeconds: 42,
      })
    );

    const { result } = renderHook(() =>
      usePollingHarness({
        initialTrackers: {
          tripA: { jobId: 'job-5', status: 'pending' },
        },
      })
    );

    await waitFor(() => {
      expect(result.current.trackers).toEqual({
        tripA: {
          jobId: 'job-5',
          status: 'pending',
          stage: 'days',
          stageLabel: 'Phase 3 of 6: Building day-by-day activities',
          stageDetail: 'Choosing attractions, tours, and pacing for each day of the trip.',
          etaSeconds: 42,
        },
      });
    });
  });
});
