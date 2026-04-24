import os from 'node:os';
import { getRequestContext } from './requestContext';

export type MetricLabels = Record<string, string | number | boolean>;

/**
 * Identifier for *this* process, injected as the `instance` label on every
 * emitted metric so multi-instance Cloud Run / Kubernetes deployments can
 * `sum(...) by (instance)` in Prometheus. Prefer Cloud Run's `K_REVISION`
 * when set (uniqueness is per-revision + the Cloud Run platform appends an
 * instance suffix inside the container); fall back to the OS hostname for
 * bare-metal / Docker hosts; fall back to `local` for dev machines without
 * either.
 */
const resolveInstanceId = (): string => {
  const k = process.env.K_REVISION;
  if (k && k.trim()) return k.trim();
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

const emit = (entry: MetricEntry): void => {
  if (isStructuredOutput()) {
    console.log(JSON.stringify(entry));
    return;
  }
  const labels = entry.labels
    ? ' ' + Object.entries(entry.labels).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  const ctxSuffix = entry.requestId ? ` [req=${entry.requestId}]` : '';
  // eslint-disable-next-line no-console
  console.log(
    `[metric]${ctxSuffix} ${entry.kind}:${entry.name}=${entry.value}${labels}`
  );
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

/** Increment a counter by `amount` (default 1). */
export const incrementMetric = (
  name: string,
  labels?: MetricLabels,
  amount = 1
): void => {
  counterTotals.set(name, (counterTotals.get(name) ?? 0) + amount);
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

export interface MetricCounterSnapshot {
  /** Monotonic-since-start counts of every `incrementMetric` name. */
  counters: Record<string, number>;
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

export const getMetricCounterSnapshot = (): MetricCounterSnapshot => {
  const counters: Record<string, number> = {};
  for (const [name, value] of counterTotals.entries()) {
    counters[name] = value;
  }
  const gauges = Array.from(gaugeValues.values())
    .map((entry) => ({ name: entry.name, labels: entry.labels, value: entry.value }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    counters,
    gauges,
    cacheRatios: buildCacheRatios(counterTotals),
    startedAtIso: countersStartedAtIso,
    snapshotAtIso: new Date().toISOString(),
  };
};

/** Test-only: zero every counter + gauge and reset the window start timestamp. */
export const resetMetricCountersForTests = (): void => {
  counterTotals.clear();
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

/** Record a duration in milliseconds. */
export const recordTiming = (
  name: string,
  durationMs: number,
  labels?: MetricLabels
): void => {
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
