import { Router } from 'express';
import { INSTANCE_ID, TIMING_BUCKETS_MS, getMetricCounterSnapshot } from '../metrics';

const router = Router();

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/**
 * Convert a dotted metric name like `unsplash.url_lookup.cache_hit` into a
 * Prometheus-compatible identifier. Prom allows `[a-zA-Z_:][a-zA-Z0-9_:]*`
 * so we replace every disallowed character with an underscore.
 */
const toPromName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_:]/g, '_').replace(/^[^a-zA-Z_:]/, '_');

/**
 * Convert the in-process counter snapshot to Prometheus exposition format
 * (text version 0.0.4). Rules followed:
 *   - Each unique counter emits one `# TYPE <name> counter` HELP-less line
 *     followed by its value.
 *   - Cache ratios are exposed as the underlying hit/miss counters (which
 *     already appear in `counters`), plus a single gauge
 *     `cache_hit_rate{namespace="..."}` so dashboards can alert on ratio
 *     directly.
 *   - Output is deterministic (alphabetical) so diff-based tooling stays
 *     stable across requests.
 */
const formatLabels = (labels?: Record<string, string | number | boolean>): string => {
  if (!labels) return '';
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`).join(',')}}`;
};

export const renderPrometheusSnapshot = (): string => {
  const snapshot = getMetricCounterSnapshot();
  const lines: string[] = [];
  // Every line emits the resolved instance id so a multi-instance scrape
  // target can be disambiguated with `sum(...) by (instance)`. The in-
  // process counter snapshot is keyed by name only (one-bucket-per-process),
  // so the label is always this instance's id.
  const instanceLabel = `instance="${escapeLabelValue(INSTANCE_ID)}"`;

  // Counters: one TYPE line per distinct metric name, then one line per label
  // set (bounded by MAX_SERIES_PER_METRIC in metrics.ts). An unlabeled
  // counter is the single `{instance=...}` series.
  const counterNames = Object.keys(snapshot.counters).sort();
  for (const rawName of counterNames) {
    const promName = toPromName(rawName);
    lines.push(`# TYPE ${promName} counter`);
    for (const series of snapshot.counterSeries.filter((s) => s.name === rawName)) {
      lines.push(`${promName}${formatLabels({ instance: INSTANCE_ID, ...series.labels })} ${series.value}`);
    }
  }

  // Timing histograms (milliseconds), Prometheus histogram convention:
  // cumulative `_bucket{le=...}` series plus `_sum` and `_count`.
  const timingNames = Array.from(new Set(snapshot.timings.map((t) => t.name))).sort();
  for (const rawName of timingNames) {
    const promName = toPromName(rawName);
    lines.push(`# TYPE ${promName} histogram`);
    for (const timing of snapshot.timings.filter((t) => t.name === rawName)) {
      const base = { instance: INSTANCE_ID, ...timing.labels };
      TIMING_BUCKETS_MS.forEach((upper, i) => {
        lines.push(`${promName}_bucket${formatLabels({ ...base, le: String(upper) })} ${timing.buckets[i]}`);
      });
      lines.push(`${promName}_bucket${formatLabels({ ...base, le: '+Inf' })} ${timing.count}`);
      lines.push(`${promName}_sum${formatLabels(base)} ${timing.sumMs}`);
      lines.push(`${promName}_count${formatLabels(base)} ${timing.count}`);
    }
  }

  // Explicit gauges (ingestion_jobs_by_state, ingestion_pending_depth, etc.).
  // Group by name so we only emit one `# TYPE` line per gauge name even when
  // multiple label-sets exist.
  const gaugesByName = new Map<string, typeof snapshot.gauges>();
  for (const g of snapshot.gauges) {
    const list = gaugesByName.get(g.name) ?? [];
    list.push(g);
    gaugesByName.set(g.name, list);
  }
  const gaugeNames = Array.from(gaugesByName.keys()).sort();
  for (const rawName of gaugeNames) {
    const promName = toPromName(rawName);
    lines.push(`# TYPE ${promName} gauge`);
    for (const g of gaugesByName.get(rawName)!) {
      const mergedLabels = { instance: INSTANCE_ID, ...(g.labels ?? {}) };
      lines.push(`${promName}${formatLabels(mergedLabels as Record<string, string | number | boolean>)} ${g.value}`);
    }
  }

  // Cache-hit-rate gauges, keyed by namespace label.
  if (snapshot.cacheRatios.length) {
    lines.push(`# TYPE cache_hit_rate gauge`);
    for (const row of snapshot.cacheRatios) {
      lines.push(
        `cache_hit_rate{${instanceLabel},namespace="${escapeLabelValue(row.namespace)}"} ${row.hitRate.toFixed(6)}`,
      );
    }
    lines.push(`# TYPE cache_total counter`);
    for (const row of snapshot.cacheRatios) {
      lines.push(
        `cache_total{${instanceLabel},namespace="${escapeLabelValue(row.namespace)}"} ${row.total}`,
      );
    }
  }

  // Process-snapshot gauges.
  lines.push(`# TYPE counters_started_timestamp_seconds gauge`);
  lines.push(
    `counters_started_timestamp_seconds{${instanceLabel}} ${Math.floor(new Date(snapshot.startedAtIso).getTime() / 1000)}`,
  );

  return `${lines.join('\n')}\n`;
};

// Exposed at /metrics (Prom scrape convention) — intentionally mounted at the
// root in app.ts so third-party scrapers that assume `GET /metrics` work
// out of the box. No auth, per-instance only, no sensitive data.
router.get('/', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderPrometheusSnapshot());
});

export default router;
