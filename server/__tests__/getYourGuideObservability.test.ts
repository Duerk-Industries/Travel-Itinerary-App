import {
  getGetYourGuideObservabilitySnapshot,
  recordGetYourGuideApiRequest,
  recordGetYourGuideCacheEvent,
  recordGetYourGuideClick,
  recordGetYourGuideRetry,
  recordGetYourGuideSuppression,
  resetGetYourGuideObservabilityForTests,
} from '../src/services/getYourGuideObservability';

describe('GetYourGuide Phase 6 observability', () => {
  beforeEach(() => resetGetYourGuideObservabilityForTests());

  it('records privacy-safe health, cache, suppression, click, and latency summaries', () => {
    recordGetYourGuideApiRequest({ success: true, status: 200, durationMs: 20 });
    recordGetYourGuideApiRequest({ success: false, status: 429, code: 'http', durationMs: 100 });
    recordGetYourGuideRetry();
    recordGetYourGuideCacheEvent('fresh');
    recordGetYourGuideCacheEvent('stale');
    recordGetYourGuideCacheEvent('negative');
    recordGetYourGuideCacheEvent('miss');
    recordGetYourGuideSuppression('budget');
    recordGetYourGuideClick();

    const snapshot = getGetYourGuideObservabilitySnapshot();
    expect(snapshot).toEqual(expect.objectContaining({ requests: 2, successes: 1, failures: 1, retries: 1, rateLimited: 1, clicks: 1 }));
    expect(snapshot.cache).toEqual(expect.objectContaining({ hits: 1, stale: 1, negative: 1, misses: 1, total: 4 }));
    expect(snapshot.suppressionByReason).toEqual({ budget: 1 });
    expect(snapshot.failuresByCode).toEqual({ http: 1 });
    expect(snapshot.latencyMs).toEqual(expect.objectContaining({ p50: 20, p95: 100, sampleCount: 2 }));
    expect(JSON.stringify(snapshot)).not.toContain('user');
  });
});
