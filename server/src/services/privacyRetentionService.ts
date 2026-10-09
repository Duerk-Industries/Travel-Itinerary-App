import {
  delinkItineraryGenerationMetricsBefore,
  deleteExpiredAnalyticsEvents,
  delinkProviderCostLedgerBefore,
  purgeConsentEvidenceArchivedBefore,
  releaseJobLease,
  tryAcquireJobLease,
} from '../db';
import { logError, logInfo } from '../logger';
import { INSTANCE_ID } from '../metrics';
import { processPendingErasureJobs } from './privacyRightsService';
import { exportAnalyticsReportsToGcs } from '../analytics/reportService';

/**
 * Privacy retention schedule (docs/implementation-plans/analytics-upgrade.md Phase 4),
 * run from the daily retention tick. One replica at a time (job lease); every step is
 * idempotent and independent, so a failed step is simply retried the next day.
 * Phase 2 adds its stores (90-day raw events, 13-month daily facts) via registerRetentionStep.
 */

export const LINKED_DATA_RETENTION_MONTHS = 13;
export const CONSENT_EVIDENCE_RETENTION_YEARS = 3;
const LEASE_NAME = 'privacy_retention';
const LEASE_TTL_MS = 30 * 60 * 1000;

export type RetentionStep = { name: string; run: (now: Date) => Promise<number | Record<string, number>> };

const monthsBefore = (now: Date, months: number): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()));

const windowKey = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const steps: RetentionStep[] = [
  {
    // Ledger rows are monthly; unlink whole months older than the 13-month window.
    name: 'costLedgerDelinked',
    run: (now) => delinkProviderCostLedgerBefore(windowKey(monthsBefore(now, LINKED_DATA_RETENTION_MONTHS))),
  },
  {
    name: 'itineraryMetricsDelinked',
    run: (now) => delinkItineraryGenerationMetricsBefore(monthsBefore(now, LINKED_DATA_RETENTION_MONTHS).toISOString()),
  },
  {
    // Archived evidence is written at account deletion, so archived_at + 3 years = deletion + 3 years.
    name: 'consentEvidencePurged',
    run: (now) => purgeConsentEvidenceArchivedBefore(monthsBefore(now, CONSENT_EVIDENCE_RETENTION_YEARS * 12).toISOString()),
  },
  {
    // Raw product analytics events: 90-day expiry stamped at ingest (registry retentionDays).
    name: 'analyticsEventsExpired',
    run: (now) => deleteExpiredAnalyticsEvents(now.toISOString()),
  },
  {
    name: 'erasureJobs',
    run: async () => processPendingErasureJobs(),
  },
  {
    // Phase 5: daily suppressed-aggregate CSVs for ad-hoc analysis (no-op without ANALYTICS_EXPORT_BUCKET).
    name: 'analyticsCsvExport',
    run: async (now) => (await exportAnalyticsReportsToGcs(now)).written ?? 0,
  },
];

export const registerRetentionStep = (step: RetentionStep): void => {
  const index = steps.findIndex((s) => s.name === step.name);
  if (index >= 0) steps[index] = step;
  else steps.push(step);
};

export type PrivacyRetentionResult =
  | { skipped: 'lease_held' }
  | { results: Record<string, number | Record<string, number>>; errors: string[] };

export const runPrivacyRetention = async (now = new Date()): Promise<PrivacyRetentionResult> => {
  const lease = await tryAcquireJobLease(LEASE_NAME, INSTANCE_ID, LEASE_TTL_MS).catch((err) => {
    logError('[privacy-retention] lease unavailable', err);
    return null;
  });
  if (!lease) return { skipped: 'lease_held' };
  const results: Record<string, number | Record<string, number>> = {};
  const errors: string[] = [];
  try {
    for (const step of steps) {
      try {
        results[step.name] = await step.run(now);
      } catch (err) {
        errors.push(step.name);
        logError(`[privacy-retention] step ${step.name} failed`, err);
      }
    }
    logInfo(`[privacy-retention] ${JSON.stringify(results)}${errors.length ? ` errors=${errors.join(',')}` : ''}`);
    return { results, errors };
  } finally {
    await releaseJobLease(LEASE_NAME, INSTANCE_ID).catch(() => undefined);
  }
};
