import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { usePolling } from './usePolling';

export type AsyncItineraryTracker = {
  jobId: string;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
  itineraryId?: string | null;
  stage?: string | null;
  stageLabel?: string | null;
  stageDetail?: string | null;
  etaSeconds?: number | null;
  /** The original /api/itinerary/async request body, kept so a failed job can be retried
   * with the same inputs without sending the user back through the create-trip wizard. */
  request?: Record<string, unknown> | null;
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
    // Snapshot once up front rather than reading inside a setState updater — the updater
    // isn't guaranteed to run synchronously, so deriving "is anything still pending" from
    // its side effects (instead of this snapshot) raced and silently stopped polling after
    // the first tick.
    const currentTrackers = trackersRef.current;
    const currentPendingEntries = Object.entries(currentTrackers).filter(
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
          const stageFields = {
            stage: (data as any).stage ?? null,
            stageLabel: (data as any).stageLabel ?? null,
            stageDetail: (data as any).stageDetail ?? null,
            etaSeconds: typeof (data as any).etaSeconds === 'number' ? (data as any).etaSeconds : null,
          };
          if (status === 'completed') {
            const itineraryId =
              (data as any).itineraryId ?? (data as any).result?.itineraryId ?? null;
            return [tripId, { ...tracker, ...stageFields, status: 'completed' as const, itineraryId, error: undefined }] as const;
          }
          if (status === 'failed') {
            return [
              tripId,
              { ...tracker, ...stageFields, status: 'failed' as const, error: String((data as any).error ?? 'generation failed') },
            ] as const;
          }
          return [tripId, { ...tracker, ...stageFields }] as const;
        } catch (err) {
          return [tripId, { ...tracker, status: 'failed' as const, error: (err as Error).message }] as const;
        }
      })
    );

    let completedCount = 0;
    let changed = false;
    const nextState = { ...currentTrackers };
    for (const [tripId, nextTracker] of nextEntries) {
      const prevTracker = currentTrackers[tripId];
      if (
        !prevTracker ||
        prevTracker.status !== nextTracker.status ||
        prevTracker.error !== nextTracker.error ||
        prevTracker.jobId !== nextTracker.jobId ||
        prevTracker.itineraryId !== nextTracker.itineraryId ||
        prevTracker.stage !== nextTracker.stage ||
        prevTracker.etaSeconds !== nextTracker.etaSeconds
      ) {
        nextState[tripId] = nextTracker;
        changed = true;
        if (nextTracker.status === 'completed' && prevTracker?.status !== 'completed') {
          completedCount += 1;
        }
      }
    }
    const stillPending = Object.values(nextState).some((t) => t.status === 'pending');

    if (changed) {
      setAsyncItineraryByTrip(nextState);
    }

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
