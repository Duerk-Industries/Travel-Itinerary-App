import { Storage } from '@google-cloud/storage';
import { listAnalyticsEventsBetween, listProviderCostLedgerEntries } from '../db';
import { getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import { getMetricCounterSnapshot } from '../metrics';
import {
  DEFINITIONS,
  METRIC_VERSION,
  MIN_COHORT,
  REPORT_WINDOWS_DAYS,
  type ReportWindowDays,
  buildAll,
  toCsvRows,
} from './metrics';

/**
 * Admin analytics reports (docs/implementation-plans/analytics-upgrade.md Phase 5).
 *
 * Computed on demand from the bounded raw event store (≤ 90 days by retention, at most
 * MAX_EVENTS per report) and cached briefly, instead of maintaining precomputed rollups.
 * That is deliberate at canary volume: no extra job, no rollup store to erase or
 * expire. Move to daily rollups when `truncated` starts appearing or report latency
 * exceeds the 2 s budget.
 */

export const MAX_EVENTS = 50_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isReportWindow = (value: number): value is ReportWindowDays =>
  (REPORT_WINDOWS_DAYS as readonly number[]).includes(value);

const cache = new Map<number, { expiresAt: number; report: AnalyticsReport }>();

export type AnalyticsReport = ReturnType<typeof buildAll> & {
  meta: {
    metricVersion: string;
    windowDays: number;
    from: string;
    to: string;
    timezone: 'UTC';
    eventsScanned: number;
    truncated: boolean;
    latestReceivedAt: string | null;
    generatedAt: string;
    minCohort: number;
    definitions: typeof DEFINITIONS;
    notes: string[];
  };
};

export const getAnalyticsReport = async (windowDays: ReportWindowDays, now = new Date()): Promise<AnalyticsReport> => {
  const cached = cache.get(windowDays);
  if (cached && cached.expiresAt > now.getTime()) return cached.report;
  const to = now.toISOString();
  const from = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const events = await listAnalyticsEventsBetween(from, to, MAX_EVENTS);
  const latestReceivedAt = events.reduce<string | null>((latest, e) => (!latest || e.receivedAt > latest ? e.receivedAt : latest), null);
  const report: AnalyticsReport = {
    ...buildAll(events),
    meta: {
      metricVersion: METRIC_VERSION,
      windowDays,
      from,
      to,
      timezone: 'UTC',
      eventsScanned: events.length,
      truncated: events.length >= MAX_EVENTS,
      latestReceivedAt,
      generatedAt: now.toISOString(),
      minCohort: MIN_COHORT,
      definitions: DEFINITIONS,
      notes: [
        'Consenting users only: accounts that never opted in are not represented, so rates are not "all users".',
        `Counts of fewer than ${MIN_COHORT} distinct accounts are suppressed, and rates built on them are blank.`,
        'Admin and internal canary traffic is excluded.',
        'Windows are rolling UTC periods ending at generation time; results are cached for 10 minutes.',
      ],
    },
  };
  cache.set(windowDays, { expiresAt: now.getTime() + CACHE_TTL_MS, report });
  return report;
};

export const clearAnalyticsReportCacheForTesting = (): void => cache.clear();

/**
 * Reliability: server latency histograms (this instance, since start), provider attempt
 * failure rates from the cost ledger (operational counts, not people), and client task
 * failure rates from the adoption view. Client screen/trip readiness timings live in
 * Sentry (consented diagnostics), not here.
 */
export const getReliabilityReport = async (windowDays: ReportWindowDays, now = new Date()) => {
  const month = now.toISOString().slice(0, 7);
  const [ledger, adoption] = await Promise.all([
    listProviderCostLedgerEntries(month).catch(() => []),
    getAnalyticsReport(windowDays, now).then((r) => r.adoption.tasks),
  ]);
  const providers = new Map<string, { attempts: number; failed: number }>();
  for (const entry of ledger) {
    const row = providers.get(entry.provider) ?? providers.set(entry.provider, { attempts: 0, failed: 0 }).get(entry.provider)!;
    row.attempts += 1;
    if (entry.outcome === 'failed') row.failed += 1;
  }
  const snapshot = getMetricCounterSnapshot();
  return {
    serverTimings: {
      scope: 'this server instance since it started',
      startedAt: snapshot.startedAtIso,
      timings: snapshot.timings.map((t) => ({ name: t.name, labels: t.labels, count: t.count, p50Ms: t.p50Ms, p95Ms: t.p95Ms })),
    },
    providerAttempts: {
      month,
      providers: Array.from(providers.entries())
        .map(([provider, row]) => ({ provider, attempts: row.attempts, failed: row.failed, failureRate: row.attempts ? row.failed / row.attempts : null }))
        .sort((a, b) => b.attempts - a.attempts),
    },
    clientTasks: adoption,
    notes: ['Client screen and trip readiness timings are recorded in Sentry for users who opted in to detailed diagnostics.'],
  };
};

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** CSV with a commented metadata header, so an exported file is never separated from its definitions. */
export const renderReportCsv = (view: 'adoption' | 'platform' | 'trip_phase', report: AnalyticsReport): string => {
  const header = [
    `# WanderBunnies analytics export: ${view}`,
    `# metric_version=${report.meta.metricVersion} window_days=${report.meta.windowDays} from=${report.meta.from} to=${report.meta.to} timezone=UTC`,
    `# generated_at=${report.meta.generatedAt} events_scanned=${report.meta.eventsScanned} truncated=${report.meta.truncated}`,
    `# population: ${report.meta.definitions.population}`,
    `# suppression: counts below ${report.meta.minCohort} distinct accounts are blank`,
  ];
  const rows = toCsvRows(view, report).map((row) => row.map(csvCell).join(','));
  return `${[...header, ...rows].join('\n')}\n`;
};

export const CSV_VIEWS = ['adoption', 'platform', 'trip_phase'] as const;

/**
 * Daily export of suppressed aggregate CSVs to Cloud Storage for ad-hoc analysis (decision 9:
 * no BigQuery for now). Skipped unless ANALYTICS_EXPORT_BUCKET is configured. Only the
 * same suppressed aggregates the admin UI shows are written; never raw events.
 */
export const exportAnalyticsReportsToGcs = async (now = new Date()): Promise<{ skipped?: 'not_configured'; written?: number }> => {
  const bucketName = getEnvValue('ANALYTICS_EXPORT_BUCKET');
  if (!bucketName) return { skipped: 'not_configured' };
  const report = await getAnalyticsReport(30, now);
  const bucket = new Storage().bucket(bucketName);
  const dateKey = now.toISOString().slice(0, 10);
  let written = 0;
  for (const view of CSV_VIEWS) {
    try {
      await bucket.file(`analytics-exports/${dateKey}/${view}-30d.csv`).save(renderReportCsv(view, report), {
        resumable: false,
        metadata: { contentType: 'text/csv' },
      });
      written += 1;
    } catch (err) {
      logError(`[analytics-export] failed to write ${view}`, err);
    }
  }
  logInfo(`[analytics-export] wrote ${written} CSV files for ${dateKey}`);
  return { written };
};
