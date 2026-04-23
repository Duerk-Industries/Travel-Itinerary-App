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
});
