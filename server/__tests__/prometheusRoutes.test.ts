import request from 'supertest';
import { app } from '../src/app';
import { incrementMetric, resetMetricCountersForTests } from '../src/metrics';

describe('GET /metrics (Prometheus exposition)', () => {
  beforeEach(() => {
    resetMetricCountersForTests();
  });

  it('returns text/plain content with the Prom version header', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=0\.0\.4/);
  });

  it('emits TYPE + value lines for each counter, sorted alphabetically', async () => {
    incrementMetric('itinerary.generation.success');
    incrementMetric('itinerary.generation.success');
    incrementMetric('chat.message.sent');

    const res = await request(app).get('/metrics').expect(200);
    const body = res.text;

    // Dotted names get converted to prom-safe identifiers (dots → underscores).
    // Every counter line is tagged with `instance="..."` so multi-instance
    // scrapes can be disambiguated with `sum(...) by (instance)`.
    expect(body).toMatch(/# TYPE chat_message_sent counter/);
    expect(body).toMatch(/chat_message_sent\{instance="[^"]+"\} 1/);
    expect(body).toMatch(/# TYPE itinerary_generation_success counter/);
    expect(body).toMatch(/itinerary_generation_success\{instance="[^"]+"\} 2/);

    // Alphabetical order: chat_message_sent before itinerary_generation_success.
    expect(body.indexOf('chat_message_sent')).toBeLessThan(body.indexOf('itinerary_generation_success'));
  });

  it('exposes cache_hit_rate gauges labeled by namespace', async () => {
    // 9/10 hit rate on unsplash.url_lookup, 2/5 on image.gcs_bytes.
    for (let i = 0; i < 9; i += 1) incrementMetric('unsplash.url_lookup.cache_hit');
    incrementMetric('unsplash.url_lookup.cache_miss');
    for (let i = 0; i < 2; i += 1) incrementMetric('image.gcs_bytes.cache_hit');
    for (let i = 0; i < 3; i += 1) incrementMetric('image.gcs_bytes.cache_miss');

    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toMatch(/# TYPE cache_hit_rate gauge/);
    // `instance` label is prepended before `namespace` per alphabetical sort.
    expect(res.text).toMatch(/cache_hit_rate\{instance="[^"]+",namespace="image\.gcs_bytes"\} 0\.400000/);
    expect(res.text).toMatch(/cache_hit_rate\{instance="[^"]+",namespace="unsplash\.url_lookup"\} 0\.900000/);
    expect(res.text).toMatch(/cache_total\{instance="[^"]+",namespace="image\.gcs_bytes"\} 5/);
    expect(res.text).toMatch(/cache_total\{instance="[^"]+",namespace="unsplash\.url_lookup"\} 10/);
  });

  it('always emits counters_started_timestamp_seconds even when no counters have fired', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toMatch(/# TYPE counters_started_timestamp_seconds gauge/);
    expect(res.text).toMatch(/counters_started_timestamp_seconds\{instance="[^"]+"\} \d+/);
  });

  it('escapes special characters in cache namespace labels', async () => {
    incrementMetric('weird."name".cache_hit');
    incrementMetric('weird."name".cache_miss');

    const res = await request(app).get('/metrics').expect(200);
    // Quote in namespace label must be backslash-escaped. The `instance`
    // label is prepended by the renderer.
    expect(res.text).toMatch(/cache_hit_rate\{instance="[^"]+",namespace="weird\.\\"name\\""\}/);
  });

  it('tags every metric with an `instance` label derived from K_REVISION or hostname', async () => {
    incrementMetric('some.counter');
    const res = await request(app).get('/metrics').expect(200);
    // Prove the label exists and is non-empty — exact value depends on the
    // test host but must match the same regex across every emitted line.
    const matches = res.text.match(/instance="([^"]+)"/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    const firstValue = matches[0];
    for (const m of matches) expect(m).toBe(firstValue);
  });
});
