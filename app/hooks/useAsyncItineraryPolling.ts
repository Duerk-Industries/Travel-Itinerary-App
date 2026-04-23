import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { usePolling } from './usePolling';

export type AsyncItineraryTracker = {
  jobId: string;
  status: 'pending' | 'failed';
  error?: string;
};

type UseAsyncItineraryPollingParams = {
  asyncItineraryByTrip: Record<string, AsyncItineraryTracker>;
  backendUrl: string;
  headers: Record<string, string>;
  pollIntervalMs?: number;
  refreshPageData: () => Promise<unknown>;
  setAsyncItineraryByTrip: Dispatch<SetStateAction<Record<string, AsyncItineraryTracker>>>;
  userToken?: string | null;
};

export function useAsyncItineraryPolling({
  asyncItineraryByTrip,
  backendUrl,
  headers,
  pollIntervalMs = 5000,
  refreshPageData,
  setAsyncItineraryByTrip,
  userToken,
}: UseAsyncItineraryPollingParams) {
  const trackersRef = useRef(asyncItineraryByTrip);
  const refreshPageDataRef = useRef(refreshPageData);
  const headersRef = useRef(headers);

  trackersRef.current = asyncItineraryByTrip;
  refreshPageDataRef.current = refreshPageData;
  headersRef.current = headers;

  const hasPending = Object.values(asyncItineraryByTrip).some((t) => t.status === 'pending');
  const enabled = Boolean(userToken) && hasPending;

  const poll = useCallback(async () => {
    const currentPendingEntries = Object.entries(trackersRef.current).filter(
      ([, tracker]) => tracker.status === 'pending'
    );
    if (!currentPendingEntries.length) return { done: true };

    const nextEntries = await Promise.all(
      currentPendingEntries.map(async ([tripId, tracker]) => {
        try {
          const res = await fetch(
            `${backendUrl}/api/itinerary/async/${encodeURIComponent(tracker.jobId)}`,
            { headers: headersRef.current, cache: 'no-store' }
          );
          if (!res.ok) {
            return [tripId, { ...tracker, status: 'failed' as const, error: `status ${res.status}` }] as const;
          }
          const data = await res.json().catch(() => ({}));
          const status = String((data as any).status ?? '').toLowerCase();
          if (status === 'completed') return [tripId, null] as const;
          if (status === 'failed') {
            return [
              tripId,
              { ...tracker, status: 'failed' as const, error: String((data as any).error ?? 'generation failed') },
            ] as const;
          }
          return [tripId, tracker] as const;
        } catch (err) {
          return [tripId, { ...tracker, status: 'failed' as const, error: (err as Error).message }] as const;
        }
      })
    );

    let completedCount = 0;
    let stillPending = false;

    setAsyncItineraryByTrip((prev) => {
      let changed = false;
      const nextState = { ...prev };
      for (const [tripId, nextTracker] of nextEntries) {
        if (nextTracker === null) {
          if (nextState[tripId]) {
            delete nextState[tripId];
            changed = true;
            completedCount += 1;
          }
          continue;
        }
        const prevTracker = prev[tripId];
        if (
          !prevTracker ||
          prevTracker.status !== nextTracker.status ||
          prevTracker.error !== nextTracker.error ||
          prevTracker.jobId !== nextTracker.jobId
        ) {
          nextState[tripId] = nextTracker;
          changed = true;
        }
      }
      stillPending = Object.values(nextState).some((t) => t.status === 'pending');
      return changed ? nextState : prev;
    });

    if (completedCount > 0) {
      await refreshPageDataRef.current();
    }

    return { done: !stillPending };
  }, [backendUrl, setAsyncItineraryByTrip]);

  usePolling({
    enabled,
    intervalMs: pollIntervalMs,
    poll,
  });
}
