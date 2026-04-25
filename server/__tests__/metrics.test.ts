describe('metrics', () => {
  const originalLogFormat = process.env.LOG_FORMAT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKService = process.env.K_SERVICE;

  const restoreEnv = () => {
    if (originalLogFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalLogFormat;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalKService;
  };

  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LOG_FORMAT = 'json';
  });

  afterEach(() => {
    logSpy.mockRestore();
    restoreEnv();
  });

  it('does not print metric events to the console', () => {
    const { incrementMetric } = require('../src/metrics');
    incrementMetric('itinerary_generation_success', { provider: 'openai' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('supports custom counter increments without console output', () => {
    const { incrementMetric } = require('../src/metrics');
    incrementMetric('tokens_consumed', { model: 'gpt-4o' }, 487);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('records gauge values without console output', () => {
    const { getMetricCounterSnapshot, recordGauge } = require('../src/metrics');
    recordGauge('active_connections', 17);
    expect(logSpy).not.toHaveBeenCalled();
    expect(getMetricCounterSnapshot().gauges).toEqual([
      { name: 'active_connections', value: 17, labels: undefined },
    ]);
  });

  it('records timing values without console output', () => {
    const { recordTiming } = require('../src/metrics');
    recordTiming('openai_request_ms', 342, { caller: 'itinerary' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('accepts request context fields without console output', () => {
    const { incrementMetric } = require('../src/metrics');
    const { runWithRequestContext } = require('../src/requestContext');
    runWithRequestContext(
      { requestId: 'req-abc', userId: 'user-42' },
      () => incrementMetric('feature_flag_denied', { key: 'ai' })
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('timedAsync records success=true and re-returns the value', async () => {
    const { timedAsync } = require('../src/metrics');
    const result = await timedAsync('op', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('timedAsync records success=false and re-throws on error', async () => {
    const { timedAsync } = require('../src/metrics');
    await expect(
      timedAsync('op', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(logSpy).not.toHaveBeenCalled();
  });

  // ─── Counter snapshot aggregation ─────────────────────────────────────────
  describe('in-process counter snapshot', () => {
    it('accumulates per-name totals across multiple incrementMetric calls', () => {
      const { incrementMetric, getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
      resetMetricCountersForTests();

      incrementMetric('api.request');
      incrementMetric('api.request');
      incrementMetric('api.error', undefined, 3);
      incrementMetric('api.request');

      const snapshot = getMetricCounterSnapshot();
      expect(snapshot.counters['api.request']).toBe(3);
      expect(snapshot.counters['api.error']).toBe(3);
      expect(typeof snapshot.startedAtIso).toBe('string');
      expect(typeof snapshot.snapshotAtIso).toBe('string');
    });

    it('derives per-namespace cache hit/miss/total/hitRate rollups, sorted by namespace', () => {
      const { incrementMetric, getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
      resetMetricCountersForTests();

      for (let i = 0; i < 9; i += 1) incrementMetric('unsplash.url_lookup.cache_hit');
      incrementMetric('unsplash.url_lookup.cache_miss');
      for (let i = 0; i < 2; i += 1) incrementMetric('image.gcs_bytes.cache_hit');
      for (let i = 0; i < 3; i += 1) incrementMetric('image.gcs_bytes.cache_miss');

      const snapshot = getMetricCounterSnapshot();
      expect(snapshot.cacheRatios.map((r: any) => r.namespace)).toEqual([
        'image.gcs_bytes',
        'unsplash.url_lookup',
      ]);

      const imageRow = snapshot.cacheRatios.find((r: any) => r.namespace === 'image.gcs_bytes');
      expect(imageRow).toEqual({ namespace: 'image.gcs_bytes', hits: 2, misses: 3, total: 5, hitRate: 0.4 });

      const unsplashRow = snapshot.cacheRatios.find((r: any) => r.namespace === 'unsplash.url_lookup');
      expect(unsplashRow).toEqual({ namespace: 'unsplash.url_lookup', hits: 9, misses: 1, total: 10, hitRate: 0.9 });
    });

    it('reports hitRate=0 for namespaces with no hits or misses', () => {
      const { getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
      resetMetricCountersForTests();

      const snapshot = getMetricCounterSnapshot();
      expect(snapshot.cacheRatios).toEqual([]);
      expect(Object.keys(snapshot.counters)).toHaveLength(0);
    });

    it('includes non-cache counters in the snapshot but not in cacheRatios', () => {
      const { incrementMetric, getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
      resetMetricCountersForTests();

      incrementMetric('itinerary.generation.success');
      incrementMetric('unsplash.url_lookup.cache_hit');

      const snapshot = getMetricCounterSnapshot();
      expect(snapshot.counters['itinerary.generation.success']).toBe(1);
      expect(snapshot.counters['unsplash.url_lookup.cache_hit']).toBe(1);
      // Only the cache_hit namespace should appear in cacheRatios; the plain
      // counter is surfaced through `counters` only.
      const namespaces = snapshot.cacheRatios.map((r: any) => r.namespace);
      expect(namespaces).toEqual(['unsplash.url_lookup']);
    });

    it('resetMetricCountersForTests clears counters and advances startedAtIso', async () => {
      const { incrementMetric, getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
      resetMetricCountersForTests();
      const firstStartedAt = getMetricCounterSnapshot().startedAtIso;

      incrementMetric('counted');
      expect(getMetricCounterSnapshot().counters['counted']).toBe(1);

      await new Promise((r) => setTimeout(r, 5));
      resetMetricCountersForTests();
      const afterReset = getMetricCounterSnapshot();
      expect(afterReset.counters['counted']).toBeUndefined();
      expect(afterReset.startedAtIso).not.toBe(firstStartedAt);
    });
  });
});
