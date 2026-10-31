import { useEffect, useState } from 'react';
import { DEFAULT_NEW_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';

export type ActivityTourLink = { tourId: string; title: string; path: string };

/** Tours are offered while an activity can still be booked. */
export const canBookTour = (status: unknown): boolean =>
  ['Proposed', 'Needs Booking'].includes(normalizeItineraryStatus(status as any, DEFAULT_NEW_ITINERARY_STATUS));

/**
 * GetYourGuide tours matched to a trip's activities, by activity id. Purely additive: while loading,
 * or if anything fails, an activity simply has no link. `refreshKey` reloads them when activities change.
 */
export const useGetYourGuideTourLinks = (params: {
  backendUrl: string;
  headers?: Record<string, string>;
  tripId?: string | null;
  refreshKey: string;
  enabled?: boolean;
}): Record<string, ActivityTourLink> => {
  const { backendUrl, headers, tripId, refreshKey, enabled = true } = params;
  const [links, setLinks] = useState<Record<string, ActivityTourLink>>({});
  useEffect(() => {
    setLinks({});
    if (!enabled || !tripId) return undefined;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${backendUrl}/api/affiliate/getyourguide/trips/${encodeURIComponent(tripId)}/tours`, { headers });
        const data = response.ok ? await response.json() : null;
        if (active && data?.links) setLinks(data.links);
      } catch {
        // The link is optional; the activity shows as it would without one.
      }
    })();
    return () => { active = false; };
  }, [backendUrl, enabled, headers, refreshKey, tripId]);
  return links;
};
