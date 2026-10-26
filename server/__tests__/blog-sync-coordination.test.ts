import { invalidateSync, markSynced, shouldSkipSync, runBlogSyncForTrip } from '../src/blog/syncCoordination';

describe('blog syncCoordination', () => {
  const tripA = `trip-sync-coord-a-${Math.random().toString(36).slice(2)}`;
  const tripB = `trip-sync-coord-b-${Math.random().toString(36).slice(2)}`;

  it('does not skip a trip that has never been synced', () => {
    expect(shouldSkipSync(tripA)).toBe(false);
  });

  it('skips a trip synced within the debounce window', () => {
    markSynced(tripA);
    expect(shouldSkipSync(tripA)).toBe(true);
  });

  it('keeps trips independent of each other', () => {
    markSynced(tripA);
    expect(shouldSkipSync(tripB)).toBe(false);
  });

  it('stops skipping once invalidated — the write-path trigger calls this synchronously on every mutation, so a read right after an edit never trusts a stale debounce window', () => {
    markSynced(tripA);
    expect(shouldSkipSync(tripA)).toBe(true);
    invalidateSync(tripA);
    expect(shouldSkipSync(tripA)).toBe(false);
  });

  it('invalidating an already-unsynced trip is a harmless no-op', () => {
    invalidateSync(tripB);
    expect(shouldSkipSync(tripB)).toBe(false);
  });
  it('queues deletion sync behind an older sync and prevents reads from skipping pending work', async () => {
    const trip = 'queued-note-deletion';
    const events: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = runBlogSyncForTrip(trip, async () => { events.push('old'); await blocker; markSynced(trip); });
    const next = runBlogSyncForTrip(trip, async () => { events.push('delete'); markSynced(trip); });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['old']);
    expect(shouldSkipSync(trip)).toBe(false);
    release();
    await Promise.all([first, next]);
    expect(events).toEqual(['old', 'delete']);
    expect(shouldSkipSync(trip)).toBe(true);
  });

});
