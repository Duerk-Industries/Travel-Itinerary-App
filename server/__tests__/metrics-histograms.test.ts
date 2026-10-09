/// <reference types="jest" />
import {
  MAX_SERIES_PER_METRIC,
  TIMING_BUCKETS_MS,
  getMetricCounterSnapshot,
  incrementMetric,
  recordTiming,
  resetMetricCountersForTests,
  timedAsync,
} from '../src/metrics';
import { renderPrometheusSnapshot } from '../src/routes/prometheusRoutes';

describe('metrics: labeled series and timing histograms', () => {
  beforeEach(() => resetMetricCountersForTests());

  it('keeps per-label counter series that sum to the name total', () => {
    incrementMetric('billing.webhook.processed', { eventType: 'invoice.paid' });
    incrementMetric('billing.webhook.processed', { eventType: 'invoice.paid' });
    incrementMetric('billing.webhook.processed', { eventType: 'customer.updated' });
    incrementMetric('billing.webhook.processed');
    const snap = getMetricCounterSnapshot();
    expect(snap.counters['billing.webhook.processed']).toBe(4);
    const series = snap.counterSeries.filter((s) => s.name === 'billing.webhook.processed');
    expect(series.map((s) => [s.labels, s.value])).toEqual([
      [{}, 1],
      [{ eventType: 'customer.updated' }, 1],
      [{ eventType: 'invoice.paid' }, 2],
    ]);
  });

  it('folds label sets beyond the per-metric cap into one overflow series', () => {
    for (let i = 0; i < MAX_SERIES_PER_METRIC + 25; i += 1) {
      incrementMetric('runaway.metric', { id: `value-${i}` });
    }
    const series = getMetricCounterSnapshot().counterSeries.filter((s) => s.name === 'runaway.metric');
    expect(series).toHaveLength(MAX_SERIES_PER_METRIC + 1);
    expect(series.find((s) => s.labels.overflow === 'true')?.value).toBe(25);
    expect(series.reduce((sum, s) => sum + s.value, 0)).toBe(MAX_SERIES_PER_METRIC + 25);
  });

  it('retains timings as fixed-bucket histograms with count, sum and quantiles', () => {
    // 90 fast (≤10ms bucket), 10 slow (≤1000ms bucket)
    for (let i = 0; i < 90; i += 1) recordTiming('op_ms', 8, { success: true });
    for (let i = 0; i < 10; i += 1) recordTiming('op_ms', 900, { success: true });
    recordTiming('op_ms', 200000, { success: false }); // above the largest bound
    const timings = getMetricCounterSnapshot().timings;
    const ok = timings.find((t) => t.name === 'op_ms' && t.labels.success === true)!;
    expect(ok.count).toBe(100);
    expect(ok.sumMs).toBe(90 * 8 + 10 * 900);
    expect(ok.buckets[TIMING_BUCKETS_MS.indexOf(10)]).toBe(90);
    expect(ok.buckets[TIMING_BUCKETS_MS.indexOf(1000)]).toBe(100);
    expect(ok.p50Ms).toBeGreaterThan(5);
    expect(ok.p50Ms).toBeLessThanOrEqual(10);
    expect(ok.p95Ms).toBeGreaterThan(500);
    expect(ok.p95Ms).toBeLessThanOrEqual(1000);
    const failed = timings.find((t) => t.name === 'op_ms' && t.labels.success === false)!;
    expect(failed.count).toBe(1);
    expect(failed.buckets[failed.buckets.length - 1]).toBe(0); // only in +Inf
    expect(failed.p95Ms).toBe(TIMING_BUCKETS_MS[TIMING_BUCKETS_MS.length - 1]);
  });

  it('ignores negative and non-finite durations', () => {
    recordTiming('bad_ms', -5);
    recordTiming('bad_ms', Number.NaN);
    expect(getMetricCounterSnapshot().timings.filter((t) => t.name === 'bad_ms')).toEqual([]);
  });

  it('timedAsync feeds the histogram with a success label', async () => {
    await timedAsync('job_ms', async () => 'ok');
    await expect(timedAsync('job_ms', async () => { throw new Error('x'); })).rejects.toThrow('x');
    const timings = getMetricCounterSnapshot().timings.filter((t) => t.name === 'job_ms');
    expect(timings.map((t) => t.labels.success).sort()).toEqual([false, true]);
  });

  it('renders labeled counters and Prometheus histograms', () => {
    incrementMetric('feature_access_denied', { featureKey: 'csv_export', reason: 'flag_disabled' });
    recordTiming('itinerary_generation_duration_ms', 1200, { success: true });
    const text = renderPrometheusSnapshot();
    expect(text).toMatch(/feature_access_denied\{featureKey="csv_export",instance="[^"]+",reason="flag_disabled"\} 1/);
    expect(text).toMatch(/# TYPE itinerary_generation_duration_ms histogram/);
    expect(text).toMatch(/itinerary_generation_duration_ms_bucket\{instance="[^"]+",le="1000",success="true"\} 0/);
    expect(text).toMatch(/itinerary_generation_duration_ms_bucket\{instance="[^"]+",le="2500",success="true"\} 1/);
    expect(text).toMatch(/itinerary_generation_duration_ms_bucket\{instance="[^"]+",le="\+Inf",success="true"\} 1/);
    expect(text).toMatch(/itinerary_generation_duration_ms_sum\{instance="[^"]+",success="true"\} 1200/);
    expect(text).toMatch(/itinerary_generation_duration_ms_count\{instance="[^"]+",success="true"\} 1/);
  });
});

describe('metrics: instance identity', () => {
  const original = { rev: process.env.K_REVISION, override: process.env.METRICS_INSTANCE_ID };
  afterEach(() => {
    process.env.K_REVISION = original.rev;
    process.env.METRICS_INSTANCE_ID = original.override;
    if (original.rev === undefined) delete process.env.K_REVISION;
    if (original.override === undefined) delete process.env.METRICS_INSTANCE_ID;
  });

  it('suffixes K_REVISION per process so replicas of one revision do not collide', () => {
    process.env.K_REVISION = 'travel-itinerary-app-00406-tnf';
    delete process.env.METRICS_INSTANCE_ID;
    let first = '';
    let second = '';
    jest.isolateModules(() => { first = require('../src/metrics').INSTANCE_ID; });
    jest.isolateModules(() => { second = require('../src/metrics').INSTANCE_ID; });
    expect(first).toMatch(/^travel-itinerary-app-00406-tnf-[0-9a-f]{6}$/);
    expect(second).toMatch(/^travel-itinerary-app-00406-tnf-[0-9a-f]{6}$/);
    expect(first).not.toBe(second);
  });

  it('honors METRICS_INSTANCE_ID exactly', () => {
    process.env.METRICS_INSTANCE_ID = 'fixed-id';
    let id = '';
    jest.isolateModules(() => { id = require('../src/metrics').INSTANCE_ID; });
    expect(id).toBe('fixed-id');
  });
});
