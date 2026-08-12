import { invalidateSync, markSynced, shouldSkipSync } from '../src/blog/syncCoordination';

const syncItineraryToBlog = jest.fn();
jest.mock('../src/blog/repository', () => ({
  blogRepository: () => ({ syncItineraryToBlog }),
}));

// Imported after the mock above so triggerSync.ts picks up the mocked blogRepository.
import { triggerBlogSyncForTrip } from '../src/blog/triggerSync';

describe('triggerBlogSyncForTrip', () => {
  beforeEach(() => {
    syncItineraryToBlog.mockReset();
  });

  it('is a no-op when tripId is missing (e.g. the trip was deleted mid-request)', () => {
    triggerBlogSyncForTrip(null, 'user-1');
    triggerBlogSyncForTrip(undefined, 'user-1');
    expect(syncItineraryToBlog).not.toHaveBeenCalled();
  });

  it('invalidates the read-path debounce synchronously, before the background sync settles', async () => {
    const tripId = `trip-trigger-${Math.random().toString(36).slice(2)}`;
    markSynced(tripId);
    expect(shouldSkipSync(tripId)).toBe(true);

    let resolveSync: () => void = () => {};
    syncItineraryToBlog.mockReturnValue(new Promise<void>((resolve) => { resolveSync = resolve; }));

    triggerBlogSyncForTrip(tripId, 'user-1');

    // The debounce is already cleared even though the background sync above is
    // still pending — this is the guarantee that makes it safe for getBlog's
    // read-path fallback to skip re-syncing based on a stale window.
    expect(shouldSkipSync(tripId)).toBe(false);
    expect(syncItineraryToBlog).toHaveBeenCalledWith(tripId, 'user-1');

    resolveSync();
    await Promise.resolve();
    invalidateSync(tripId); // cleanup: don't leak state into other test files
  });

  it('does not throw or reject when the background sync rejects', async () => {
    const tripId = `trip-trigger-reject-${Math.random().toString(36).slice(2)}`;
    syncItineraryToBlog.mockRejectedValue(new Error('boom'));

    expect(() => triggerBlogSyncForTrip(tripId, 'user-1')).not.toThrow();
    // Let the rejected promise's .catch() handler run before the test ends,
    // so Jest doesn't report an unhandled rejection from this test.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
