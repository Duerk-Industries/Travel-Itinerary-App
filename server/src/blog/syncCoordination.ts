// Coordinates itinerary→blog sync between two triggers:
//  1. Write-time (primary): itineraryDataRoutes.ts / itineraryAsyncService.ts fire a
//     background sync immediately after an itinerary_details mutation succeeds.
//  2. Read-time (defensive fallback): getBlog() in both blog repositories still syncs
//     on every GET, in case some mutation path isn't hooked into (1) — but skips the
//     work entirely if a sync has completed recently, since the common case (opening
//     or refreshing the blog with no intervening itinerary edit) has nothing new to
//     find.
//
// The two are kept consistent by invalidating the debounce window synchronously at
// mutation time (cheap, in-memory, no I/O) — so a read immediately after an edit never
// trusts a debounce window that predates that edit, even if the write-path's own
// background sync hasn't finished yet. Worst case in that race is one redundant sync
// (safe, just some wasted work); it never serves stale data.
//
// In-process only, matching the rest of this module's assumption of a single Cloud Run
// instance (see the presence-manager note in App.tsx/CLAUDE.md for the same
// single-instance caveat elsewhere in this codebase). A cold start or multi-instance
// deploy simply starts everyone back at "no recent sync recorded", which just means the
// first read after a restart pays the full sync cost again — never a correctness issue.

const DEBOUNCE_MS = 60_000;
const lastSyncedAtByTrip = new Map<string, number>();

export const shouldSkipSync = (tripId: string): boolean => {
  const last = lastSyncedAtByTrip.get(tripId);
  return last != null && Date.now() - last < DEBOUNCE_MS;
};

export const markSynced = (tripId: string): void => {
  lastSyncedAtByTrip.set(tripId, Date.now());
};

export const invalidateSync = (tripId: string): void => {
  lastSyncedAtByTrip.delete(tripId);
};
