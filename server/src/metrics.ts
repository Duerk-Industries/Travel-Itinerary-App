import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { getRequestContext } from './requestContext';

export type MetricLabels = Record<string, string | number | boolean>;

/**
 * Identifier for *this* process, injected as the `instance` label on every
 * emitted metric so multi-instance Cloud Run / Kubernetes deployments can
 * `sum(...) by (instance)` in Prometheus. `K_REVISION` alone is shared by
 * every instance of a Cloud Run revision, so a random per-process suffix is
 * appended — otherwise replicas' series collide and counter resets look like
 * falling activity. Falls back to the OS hostname for bare-metal / Docker
 * hosts and to `local` for dev machines without either.
 */
const PROCESS_SUFFIX = randomBytes(3).toString('hex');

const resolveInstanceId = (): string => {
  const k = process.env.K_REVISION;
  if (k && k.trim()) return `${k.trim()}-${PROCESS_SUFFIX}`;
  try {
    const host = os.hostname();
    if (host && host.trim()) return host.trim();
  } catch { /* ignore */ }
  return 'local';
};

/**
 * Resolved once at module load. Overridable via METRICS_INSTANCE_ID for
 * tests or synthetic multi-instance simulations.
 */
export const INSTANCE_ID: string =
  (process.env.METRICS_INSTANCE_ID && process.env.METRICS_INSTANCE_ID.trim())
    ? process.env.METRICS_INSTANCE_ID.trim()
    : resolveInstanceId();

const isStructuredOutput = (): boolean => {
  const explicit = process.env.LOG_FORMAT;
  if (explicit === 'json') return true;
  if (explicit === 'text') return false;
  return process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
};

type MetricEntry = {
  level: 'info';
  channel: 'metric';
  time: string;
  name: string;
  kind: 'counter' | 'gauge' | 'timing';
  value: number;
  labels?: MetricLabels;
  requestId?: string;
  userId?: string;
};

const emit = (_entry: MetricEntry): void => {
  // Metrics are retained in-process for admin/Prometheus endpoints. Do not
  // print every metric event; high-volume console output can make local runs
  // and hosted logs noisy without improving the counters we expose.
};

const baseEntry = (
  name: string,
  kind: MetricEntry['kind'],
  value: number,
  labels?: MetricLabels
): MetricEntry => {
  const ctx = getRequestContext();
  const entry: MetricEntry = {
    level: 'info',
    channel: 'metric',
    time: new Date().toISOString(),
    name,
    kind,
    value,
  };
  // Always tag emitted metrics with the resolved instance id so Prometheus
  // `sum(...) by (instance)` works across Cloud Run revisions. Caller-supplied
  // labels win on key collision — they can opt out by passing their own
  // `instance` value if they really want to.
  const merged: MetricLabels = { instance: INSTANCE_ID, ...(labels ?? {}) };
  entry.labels = merged;
  if (ctx?.requestId) entry.requestId = ctx.requestId;
  if (ctx?.userId) entry.userId = ctx.userId;
  return entry;
};

// ── In-process counter + gauge storage ──────────────────────────────────────
// Best-effort per-process aggregation, used by `GET /api/admin/metrics` so
// operators can see cache hit-rates without a full metrics backend. Multi-
// instance deployments will see per-instance numbers — that's documented on
// the admin endpoint.
const counterTotals: Map<string, number> = new Map();
// Gauges keep the most recent value per (name, label-set) key. Used for
// point-in-time queue-depth readings emitted by the ingestion metrics tick.
const gaugeValues: Map<string, { name: string; value: number; labels?: MetricLabels }> = new Map();
let countersStartedAtIso = new Date().toISOString();

const gaugeKey = (name: string, labels?: MetricLabels): string => {
  if (!labels) return name;
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return `${name}{${entries.map(([k, v]) => `${k}=${String(v)}`).join(',')}}`;
};

// ── Labeled series (counters + timing histograms) ───────────────────────────
// Labels are kept per series so `/metrics` can break counters and latency down
// by low-cardinality dimensions (eventType, reason, success, ...). Each metric
// name may hold at most MAX_SERIES_PER_METRIC label sets; further label sets
// fold into one `{overflow="true"}` series so a caller that accidentally
// passes an unbounded value (an ID, free text, a count) cannot grow memory or
// the scrape without bound. Never pass user/trip/request IDs or free text.
export const MAX_SERIES_PER_METRIC = 50;
const OVERFLOW_LABELS: MetricLabels = { overflow: 'true' };

type SeriesStore<T> = Map<string, Map<string, { labels: MetricLabels; value: T }>>;

const labelKey = (labels?: MetricLabels): string => (labels ? gaugeKey('', labels) : '');

const resolveSeries = <T>(store: SeriesStore<T>, name: string, labels: MetricLabels | undefined, init: () => T) => {
  let series = store.get(name);
  if (!series) {
    series = new Map();
    store.set(name, series);
  }
  const key = labelKey(labels);
  const existing = series.get(key);
  if (existing) return existing;
  if (series.size >= MAX_SERIES_PER_METRIC) {
    const overflowKey = labelKey(OVERFLOW_LABELS);
    const overflow = series.get(overflowKey) ?? { labels: OVERFLOW_LABELS, value: init() };
    series.set(overflowKey, overflow);
    return overflow;
  }
  const created = { labels: labels ?? {}, value: init() };
  series.set(key, created);
  return created;
};

const counterSeries: SeriesStore<number> = new Map();

/**
 * Fixed latency buckets (upper bounds, milliseconds) shared by every timing
 * histogram so series can be aggregated across instances and names.
 */
export const TIMING_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000] as const;

type Histogram = { buckets: number[]; count: number; sumMs: number };
const timingSeries: SeriesStore<Histogram> = new Map();
const newHistogram = (): Histogram => ({ buckets: TIMING_BUCKETS_MS.map(() => 0), count: 0, sumMs: 0 });

/** Increment a counter by `amount` (default 1). */
export const incrementMetric = (
  name: string,
  labels?: MetricLabels,
  amount = 1
): void => {
  counterTotals.set(name, (counterTotals.get(name) ?? 0) + amount);
  resolveSeries(counterSeries, name, labels, () => 0).value += amount;
  emit(baseEntry(name, 'counter', amount, labels));
};

/**
 * Cache-namespace metric summary pairing `{ns}.cache_hit` + `{ns}.cache_miss`
 * counts. Each TtlCache instance with a configured `metricName` contributes
 * one row. Ratios are 0..1; when total=0 the ratio is reported as 0.
 */
export interface CacheRatioEntry {
  namespace: string;
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
}

export interface MetricGaugeEntry {
  name: string;
  labels?: MetricLabels;
  value: number;
}

export interface MetricSeriesEntry {
  name: string;
  labels: MetricLabels;
  value: number;
}

export interface MetricTimingEntry {
  name: string;
  labels: MetricLabels;
  count: number;
  sumMs: number;
  /** Cumulative counts per TIMING_BUCKETS_MS upper bound (Prometheus `le` semantics, +Inf = count). */
  buckets: number[];
  /** Bucket-interpolated estimates; null when no observations. */
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface MetricCounterSnapshot {
  /** Monotonic-since-start counts of every `incrementMetric` name. */
  counters: Record<string, number>;
  /** Per-label-set counter values; sums to `counters[name]` for each name. */
  counterSeries: MetricSeriesEntry[];
  /** Latency histograms recorded by `recordTiming` / `timedAsync`. */
  timings: MetricTimingEntry[];
  /** Most-recent value per (name, label-set) for every `recordGauge` call. */
  gauges: MetricGaugeEntry[];
  /** Cache-namespace rollups derived from `*.cache_hit` / `*.cache_miss` entries. */
  cacheRatios: CacheRatioEntry[];
  /** ISO time when this counter window began — i.e. process boot or last reset. */
  startedAtIso: string;
  /** Server time when the snapshot was produced. */
  snapshotAtIso: string;
}

const CACHE_HIT_SUFFIX = '.cache_hit';
const CACHE_MISS_SUFFIX = '.cache_miss';

const buildCacheRatios = (counters: Map<string, number>): CacheRatioEntry[] => {
  const namespaces = new Map<string, { hits: number; misses: number }>();
  for (const [name, count] of counters.entries()) {
    if (name.endsWith(CACHE_HIT_SUFFIX)) {
      const ns = name.slice(0, -CACHE_HIT_SUFFIX.length);
      const entry = namespaces.get(ns) ?? { hits: 0, misses: 0 };
      entry.hits += count;
      namespaces.set(ns, entry);
    } else if (name.endsWith(CACHE_MISS_SUFFIX)) {
      const ns = name.slice(0, -CACHE_MISS_SUFFIX.length);
      const entry = namespaces.get(ns) ?? { hits: 0, misses: 0 };
      entry.misses += count;
      namespaces.set(ns, entry);
    }
  }
  return Array.from(namespaces.entries())
    .map(([namespace, { hits, misses }]) => {
      const total = hits + misses;
      const hitRate = total === 0 ? 0 : hits / total;
      return { namespace, hits, misses, total, hitRate };
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
};

/**
 * Estimate a quantile from cumulative bucket counts by linear interpolation
 * inside the bucket that crosses the target rank. Observations above the
 * largest bound report that bound (the estimate is a floor, labeled as such
 * by `/metrics` consumers using the raw buckets).
 */
const estimateQuantileMs = (cumulative: number[], count: number, q: number): number | null => {
  if (count <= 0) return null;
  const rank = q * count;
  for (let i = 0; i < cumulative.length; i += 1) {
    if (cumulative[i] >= rank) {
      const lower = i === 0 ? 0 : TIMING_BUCKETS_MS[i - 1];
      const upper = TIMING_BUCKETS_MS[i];
      const below = i === 0 ? 0 : cumulative[i - 1];
      const inBucket = cumulative[i] - below;
      const fraction = inBucket > 0 ? (rank - below) / inBucket : 1;
      return Math.round(lower + (upper - lower) * fraction);
    }
  }
  return TIMING_BUCKETS_MS[TIMING_BUCKETS_MS.length - 1];
};

export const getMetricCounterSnapshot = (): MetricCounterSnapshot => {
  const counters: Record<string, number> = {};
  for (const [name, value] of counterTotals.entries()) {
    counters[name] = value;
  }
  const gauges = Array.from(gaugeValues.values())
    .map((entry) => ({ name: entry.name, labels: entry.labels, value: entry.value }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const counterSeriesEntries: MetricSeriesEntry[] = [];
  for (const [name, series] of counterSeries.entries()) {
    for (const { labels, value } of series.values()) counterSeriesEntries.push({ name, labels, value });
  }
  counterSeriesEntries.sort((a, b) => a.name.localeCompare(b.name) || labelKey(a.labels).localeCompare(labelKey(b.labels)));
  const timings: MetricTimingEntry[] = [];
  for (const [name, series] of timingSeries.entries()) {
    for (const { labels, value } of series.values()) {
      let running = 0;
      const cumulative = value.buckets.map((n) => (running += n));
      timings.push({
        name,
        labels,
        count: value.count,
        sumMs: value.sumMs,
        buckets: cumulative,
        p50Ms: estimateQuantileMs(cumulative, value.count, 0.5),
        p95Ms: estimateQuantileMs(cumulative, value.count, 0.95),
      });
    }
  }
  timings.sort((a, b) => a.name.localeCompare(b.name) || labelKey(a.labels).localeCompare(labelKey(b.labels)));
  return {
    counters,
    counterSeries: counterSeriesEntries,
    timings,
    gauges,
    cacheRatios: buildCacheRatios(counterTotals),
    startedAtIso: countersStartedAtIso,
    snapshotAtIso: new Date().toISOString(),
  };
};

/** Test-only: zero every counter + gauge and reset the window start timestamp. */
export const resetMetricCountersForTests = (): void => {
  counterTotals.clear();
  counterSeries.clear();
  timingSeries.clear();
  gaugeValues.clear();
  countersStartedAtIso = new Date().toISOString();
};

/** Record a point-in-time gauge value. */
export const recordGauge = (
  name: string,
  value: number,
  labels?: MetricLabels
): void => {
  gaugeValues.set(gaugeKey(name, labels), { name, value, labels });
  emit(baseEntry(name, 'gauge', value, labels));
};

/**
 * Record a duration in milliseconds into a fixed-bucket histogram, so the
 * admin snapshot and `/metrics` can report counts, sums and p50/p95.
 */
export const recordTiming = (
  name: string,
  durationMs: number,
  labels?: MetricLabels
): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const histogram = resolveSeries(timingSeries, name, labels, newHistogram).value;
  const index = TIMING_BUCKETS_MS.findIndex((upper) => durationMs <= upper);
  if (index >= 0) histogram.buckets[index] += 1;
  histogram.count += 1;
  histogram.sumMs += durationMs;
  emit(baseEntry(name, 'timing', durationMs, labels));
};

/**
 * Run `fn` and record its duration under `name`. Re-throws on error but still
 * emits the timing with a `success=false` label so failure latency is visible.
 */
export const timedAsync = async <T>(
  name: string,
  fn: () => Promise<T>,
  labels?: MetricLabels
): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    recordTiming(name, Date.now() - start, { ...labels, success: true });
    return result;
  } catch (err) {
    recordTiming(name, Date.now() - start, { ...labels, success: false });
    throw err;
  }
};
