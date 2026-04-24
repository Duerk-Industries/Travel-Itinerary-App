import { Router } from 'express';
import { getMetricCounterSnapshot } from '../metrics';

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
export const renderPrometheusSnapshot = (): string => {
  const snapshot = getMetricCounterSnapshot();
  const lines: string[] = [];

  // Counters (one TYPE line per distinct metric name).
  const counterNames = Object.keys(snapshot.counters).sort();
  for (const rawName of counterNames) {
    const promName = toPromName(rawName);
    lines.push(`# TYPE ${promName} counter`);
    lines.push(`${promName} ${snapshot.counters[rawName]}`);
  }

  // Cache-hit-rate gauges, keyed by namespace label.
  if (snapshot.cacheRatios.length) {
    lines.push(`# TYPE cache_hit_rate gauge`);
    for (const row of snapshot.cacheRatios) {
      lines.push(
        `cache_hit_rate{namespace="${escapeLabelValue(row.namespace)}"} ${row.hitRate.toFixed(6)}`,
      );
    }
    lines.push(`# TYPE cache_total counter`);
    for (const row of snapshot.cacheRatios) {
      lines.push(
        `cache_total{namespace="${escapeLabelValue(row.namespace)}"} ${row.total}`,
      );
    }
  }

  // Process-snapshot gauges.
  lines.push(`# TYPE counters_started_timestamp_seconds gauge`);
  lines.push(
    `counters_started_timestamp_seconds ${Math.floor(new Date(snapshot.startedAtIso).getTime() / 1000)}`,
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
