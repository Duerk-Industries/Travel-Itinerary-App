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

  it('emits a counter as structured JSON', () => {
    const { incrementMetric } = require('../src/metrics');
    incrementMetric('itinerary_generation_success', { provider: 'openai' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: 'info',
      channel: 'metric',
      kind: 'counter',
      name: 'itinerary_generation_success',
      value: 1,
      labels: { provider: 'openai' },
    });
    expect(typeof parsed.time).toBe('string');
  });

  it('supports custom counter increments', () => {
    const { incrementMetric } = require('../src/metrics');
    incrementMetric('tokens_consumed', { model: 'gpt-4o' }, 487);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.value).toBe(487);
    expect(parsed.kind).toBe('counter');
  });

  it('records gauge values', () => {
    const { recordGauge } = require('../src/metrics');
    recordGauge('active_connections', 17);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ kind: 'gauge', value: 17, name: 'active_connections' });
  });

  it('records timing values', () => {
    const { recordTiming } = require('../src/metrics');
    recordTiming('openai_request_ms', 342, { caller: 'itinerary' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ kind: 'timing', value: 342, labels: { caller: 'itinerary' } });
  });

  it('includes request context fields when present', () => {
    const { incrementMetric } = require('../src/metrics');
    const { runWithRequestContext } = require('../src/requestContext');
    runWithRequestContext(
      { requestId: 'req-abc', userId: 'user-42' },
      () => incrementMetric('feature_flag_denied', { key: 'ai' })
    );
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.requestId).toBe('req-abc');
    expect(parsed.userId).toBe('user-42');
  });

  it('timedAsync records success=true and re-returns the value', async () => {
    const { timedAsync } = require('../src/metrics');
    const result = await timedAsync('op', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return 'ok';
    });
    expect(result).toBe('ok');
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.kind).toBe('timing');
    expect(parsed.labels).toMatchObject({ success: true });
    expect(parsed.value).toBeGreaterThanOrEqual(0);
  });

  it('timedAsync records success=false and re-throws on error', async () => {
    const { timedAsync } = require('../src/metrics');
    await expect(
      timedAsync('op', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.labels).toMatchObject({ success: false });
  });

  it('falls back to text format when LOG_FORMAT=text', () => {
    process.env.LOG_FORMAT = 'text';
    const { incrementMetric } = require('../src/metrics');
    incrementMetric('foo', { a: 'b' });
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('[metric]');
    expect(line).toContain('counter:foo=1');
    expect(line).toContain('a=b');
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
