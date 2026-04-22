import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

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
  const inFlightRef = useRef(false);

  useEffect(() => {
    trackersRef.current = asyncItineraryByTrip;
  }, [asyncItineraryByTrip]);

  useEffect(() => {
    refreshPageDataRef.current = refreshPageData;
  }, [refreshPageData]);

  useEffect(() => {
    if (!userToken) return;
    const pendingEntries = Object.entries(asyncItineraryByTrip).filter(([, tracker]) => tracker.status === 'pending');
    if (!pendingEntries.length) return;

    let cancelled = false;
    const poll = async () => {
      if (inFlightRef.current) return;

      const currentPendingEntries = Object.entries(trackersRef.current).filter(([, tracker]) => tracker.status === 'pending');
      if (!currentPendingEntries.length) return;

      inFlightRef.current = true;
      try {
        const nextEntries = await Promise.all(
          currentPendingEntries.map(async ([tripId, tracker]) => {
            try {
              const res = await fetch(`${backendUrl}/api/itinerary/async/${encodeURIComponent(tracker.jobId)}`, {
                headers,
                cache: 'no-store',
              });
              if (!res.ok) return [tripId, { ...tracker, status: 'failed', error: `status ${res.status}` }] as const;
              const data = await res.json().catch(() => ({}));
              const status = String((data as any).status ?? '').toLowerCase();
              if (status === 'completed') return [tripId, null] as const;
              if (status === 'failed') {
                return [tripId, { ...tracker, status: 'failed', error: String((data as any).error ?? 'generation failed') }] as const;
              }
              return [tripId, tracker] as const;
            } catch (err) {
              return [tripId, { ...tracker, status: 'failed', error: (err as Error).message }] as const;
            }
          })
        );

        if (cancelled) return;

        let changed = false;
        let completedCount = 0;

        setAsyncItineraryByTrip((prev) => {
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
          return changed ? nextState : prev;
        });

        if (completedCount > 0) {
          await refreshPageDataRef.current();
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [asyncItineraryByTrip, backendUrl, headers, pollIntervalMs, setAsyncItineraryByTrip, userToken]);
}
