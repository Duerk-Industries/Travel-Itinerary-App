/**
 * Regression test for the in-memory itinerary job store. Before the fix, the
 * `jobs` Map only ever grew — completed/failed jobs were never evicted, so a
 * long-running server process would eventually OOM under sustained load.
 *
 * The fix introduces a `pruneStaleJobs` helper that:
 *   1. Drops terminal (completed/failed) jobs older than a TTL.
 *   2. Enforces a count cap, evicting terminal jobs first.
 *
 * We exercise both phases via the module's __testing surface.
 */

import { __testing } from '../src/services/itineraryAsyncService';

type Job = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  updatedAt: string;
  userId: string;
  tripId: string;
  createdAt: string;
};

const seedJob = (overrides: Partial<Job>): Job => ({
  id: overrides.id ?? 'job',
  status: overrides.status ?? 'completed',
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  userId: 'u',
  tripId: 't',
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  ...overrides,
});

describe('itineraryAsyncService.pruneStaleJobs', () => {
  beforeEach(() => {
    __testing.jobs.clear();
  });

  it('evicts terminal jobs whose updatedAt is older than the TTL', () => {
    const now = Date.now();
    const ttlMs = 60_000;
    __testing.jobs.set('old-success', seedJob({
      id: 'old-success',
      status: 'completed',
      updatedAt: new Date(now - ttlMs - 1).toISOString(),
    }) as never);
    __testing.jobs.set('fresh-success', seedJob({
      id: 'fresh-success',
      status: 'completed',
      updatedAt: new Date(now).toISOString(),
    }) as never);
    __testing.jobs.set('old-failed', seedJob({
      id: 'old-failed',
      status: 'failed',
      updatedAt: new Date(now - ttlMs - 1).toISOString(),
    }) as never);

    __testing.pruneStaleJobs({ ttlMs, limit: 999, now });

    expect(__testing.jobs.has('old-success')).toBe(false);
    expect(__testing.jobs.has('old-failed')).toBe(false);
    expect(__testing.jobs.has('fresh-success')).toBe(true);
  });

  it('never evicts in-flight (queued / running) jobs even when they are old', () => {
    const now = Date.now();
    const ttlMs = 60_000;
    __testing.jobs.set('stuck-queued', seedJob({
      id: 'stuck-queued',
      status: 'queued',
      updatedAt: new Date(now - ttlMs * 10).toISOString(),
    }) as never);
    __testing.jobs.set('stuck-running', seedJob({
      id: 'stuck-running',
      status: 'running',
      updatedAt: new Date(now - ttlMs * 10).toISOString(),
    }) as never);

    __testing.pruneStaleJobs({ ttlMs, limit: 999, now });

    expect(__testing.jobs.has('stuck-queued')).toBe(true);
    expect(__testing.jobs.has('stuck-running')).toBe(true);
  });

  it('enforces the count cap, evicting terminal jobs before active ones', () => {
    const now = Date.now();
    // Populate 3 terminal jobs (older->newer) + 2 active jobs. With limit=2,
    // we expect both active jobs to survive and only the newest terminal to
    // remain.
    __testing.jobs.set('t-old', seedJob({ id: 't-old', status: 'completed', updatedAt: new Date(now - 3000).toISOString() }) as never);
    __testing.jobs.set('t-mid', seedJob({ id: 't-mid', status: 'failed', updatedAt: new Date(now - 2000).toISOString() }) as never);
    __testing.jobs.set('t-new', seedJob({ id: 't-new', status: 'completed', updatedAt: new Date(now - 1000).toISOString() }) as never);
    __testing.jobs.set('a-1', seedJob({ id: 'a-1', status: 'running', updatedAt: new Date(now - 500).toISOString() }) as never);
    __testing.jobs.set('a-2', seedJob({ id: 'a-2', status: 'queued', updatedAt: new Date(now).toISOString() }) as never);

    __testing.pruneStaleJobs({ ttlMs: 0, limit: 2, now });

    expect(__testing.jobs.has('a-1')).toBe(true);
    expect(__testing.jobs.has('a-2')).toBe(true);
    // All three terminal jobs evicted (we're at the cap with the active jobs alone).
    expect(__testing.jobs.has('t-old')).toBe(false);
    expect(__testing.jobs.has('t-mid')).toBe(false);
    expect(__testing.jobs.has('t-new')).toBe(false);
    expect(__testing.jobs.size).toBe(2);
  });

  it('no-ops when the store is empty', () => {
    expect(() => __testing.pruneStaleJobs()).not.toThrow();
    expect(__testing.jobs.size).toBe(0);
  });
});
