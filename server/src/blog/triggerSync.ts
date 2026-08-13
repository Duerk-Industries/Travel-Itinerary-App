import { blogRepository } from './repository';
import { invalidateSync } from './syncCoordination';
import { logError } from '../logger';

// Call this right after an itinerary_details mutation succeeds (add/update/delete —
// see server/src/routes/itineraryDataRoutes.ts and
// server/src/services/itineraryAsyncService.ts, the only two places that mutate that
// table). Deliberately fire-and-forget: the itinerary edit/generation request must not
// wait on — or fail because of — a blog sync. `invalidateSync` runs synchronously so
// that even if the background sync below hasn't finished by the time the client's next
// GET /blog arrives, that GET won't trust a debounce window from before this edit (see
// syncCoordination.ts); the background sync then completes the actual work so most reads
// find it already done.
//
// tripId may be null for callers that only have an itineraryId/detailId in hand and
// failed to resolve it (e.g. the trip was deleted mid-request) — a no-op in that case
// rather than a thrown error, since this is a best-effort optimization, not a required
// step of the mutation it's attached to.
export const triggerBlogSyncForTrip = (tripId: string | null | undefined, userId: string): void => {
  if (!tripId) return;
  invalidateSync(tripId);
  void blogRepository()
    .syncItineraryToBlog(tripId, userId)
    .catch((err) => logError(`[blog] triggerBlogSyncForTrip failed for trip ${tripId}`, err));
};
