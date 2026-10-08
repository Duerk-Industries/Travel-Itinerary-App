import { createHmac, randomUUID } from 'node:crypto';
import {
  archivePrivacyChoiceEvidence,
  delinkItineraryGenerationMetricsForUser,
  delinkProviderCostLedgerUser,
  getErasureJob,
  getErasureTombstone,
  listErasureJobs,
  rotateDiagnosticPseudonym,
  saveErasureJob,
  upsertErasureTombstone,
} from '../db';
import { getAuthSecret } from '../authConfig';
import { logError, logInfo } from '../logger';
import { incrementMetric } from '../metrics';
import type {
  ErasureScope,
  ErasureStepState,
  PrivacyErasureJob,
  PrivacyJurisdiction,
} from '../types';

/**
 * Data-subject rights handling (docs/implementation-plans/analytics-upgrade.md Phase 4).
 *
 * Erasure runs as a durable job: each registered step records its own result, a
 * failed step is retried by the retention tick, and the job keeps the raw user ID
 * only until it completes. A tombstone keyed by an HMAC of the account ID
 * (never the raw ID) lets later writers — queued analytics batches, async cost
 * settlements — recognise an erased subject and refuse to re-link data to it.
 *
 * Phase 2 stores (raw events, pseudonym map, daily facts) plug in through
 * registerErasureStep; nothing else in this module needs to change.
 */

export const ERASURE_DUE_DAYS = 30;
export const MAX_ERASURE_ATTEMPTS = 5;

/** Stable pseudonymous key for an account, usable after the account row is gone. */
export const subjectHash = (userId: string): string =>
  createHmac('sha256', getAuthSecret()).update(`privacy-subject:${userId}`).digest('hex');

export type ErasureStepResult = { affected?: number | null; note?: string; notApplicable?: boolean };
export type ErasureStep = {
  name: string;
  scopes: ErasureScope[];
  run: (userId: string, job: PrivacyErasureJob) => Promise<ErasureStepResult>;
};

const steps: ErasureStep[] = [];

/** Adds an erasure step; steps run in registration order. Re-registering a name replaces it. */
export const registerErasureStep = (step: ErasureStep): void => {
  const index = steps.findIndex((s) => s.name === step.name);
  if (index >= 0) steps[index] = step;
  else steps.push(step);
};

export const listErasureSteps = (scope: ErasureScope): ErasureStep[] => steps.filter((s) => s.scopes.includes(scope));

// Order matters for account erasure: consent evidence is archived before the
// account cascade deletes privacy_choice_events.
registerErasureStep({
  name: 'consent_evidence_archive',
  scopes: ['account'],
  run: async (userId, job) => ({
    affected: await archivePrivacyChoiceEvidence(userId, job.subjectHash),
    note: 'Minimal consent evidence kept under a pseudonymous key for 3 years after deletion.',
  }),
});
registerErasureStep({
  name: 'itinerary_generation_metrics',
  scopes: ['analytics', 'account'],
  run: async (userId) => ({
    affected: await delinkItineraryGenerationMetricsForUser(userId),
    note: 'User and trip identifiers removed, including inside stored metrics JSON.',
  }),
});
registerErasureStep({
  name: 'diagnostic_pseudonym',
  scopes: ['analytics'],
  run: async (userId) => ({
    affected: await rotateDiagnosticPseudonym(userId),
    note: 'Detailed-diagnostics pseudonym rotated; earlier Sentry data cannot be joined to later data and expires within 30 days.',
  }),
});
registerErasureStep({
  name: 'cost_ledger',
  scopes: ['account'],
  run: async (userId) => ({
    affected: await delinkProviderCostLedgerUser(userId),
    note: 'Provider spend kept for budgets and invoices; link to the account removed.',
  }),
});
registerErasureStep({
  // Firestore has no cascade, and deleteDevice only disables a device, so encrypted
  // push tokens would otherwise outlive the account.
  name: 'push_tokens',
  scopes: ['account'],
  run: async (userId) => {
    // Loaded lazily: notificationRepository pulls in db.postgres, whose import graph leads
    // back to providerBudgeting (which imports this module) and would form a cycle.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { notificationRepository } = require('./notificationRepository') as typeof import('./notificationRepository');
    return { affected: await notificationRepository().purgeDevicesForUser(userId) };
  },
});
registerErasureStep({
  name: 'ai_captures',
  scopes: ['analytics', 'account'],
  run: async () => ({
    notApplicable: true,
    note: 'AI captures carry only a salted hash, are not indexed by account, and are deleted by the 30-day storage lifecycle rule.',
  }),
});
registerErasureStep({
  name: 'product_analytics_events',
  scopes: ['analytics', 'account'],
  run: async () => ({
    notApplicable: true,
    note: 'Product analytics collection is not active yet (Phase 2); nothing stored.',
  }),
});

const addDays = (iso: string, days: number): string => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

const summarize = (job: PrivacyErasureJob): PrivacyErasureJob => {
  const states = Object.values(job.steps);
  const failed = states.some((s) => s.status === 'failed' || s.status === 'pending');
  return failed ? { ...job, status: 'failed' } : { ...job, status: 'completed', completedAt: new Date().toISOString(), userId: null };
};

/** Runs every not-yet-done step of a job and persists the outcome. Safe to call repeatedly. */
export const runErasureJob = async (job: PrivacyErasureJob): Promise<PrivacyErasureJob> => {
  if (job.status === 'completed' || !job.userId) return job;
  const userId = job.userId;
  const next: PrivacyErasureJob = { ...job, steps: { ...job.steps }, attempts: job.attempts + 1, lastError: null };
  for (const step of listErasureSteps(job.scope)) {
    const current = next.steps[step.name];
    if (current?.status === 'done' || current?.status === 'not_applicable') continue;
    try {
      const result = await step.run(userId, next);
      next.steps[step.name] = {
        status: result.notApplicable ? 'not_applicable' : 'done',
        affected: result.affected ?? null,
        ...(result.note ? { note: result.note } : {}),
      } satisfies ErasureStepState;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      next.steps[step.name] = { status: 'failed', error: message.slice(0, 300) };
      next.lastError = `${step.name}: ${message}`.slice(0, 500);
      logError(`[privacy] erasure step ${step.name} failed`, { jobId: job.id, error: message });
    }
  }
  const finished = summarize(next);
  await saveErasureJob(finished);
  incrementMetric('privacy.erasure_job_run', { scope: job.scope, status: finished.status });
  return finished;
};

/**
 * Records the tombstone and a durable job, then runs the job immediately. A step
 * that fails is retried by processPendingErasureJobs; the caller gets the job state.
 */
export const requestErasure = async (
  userId: string,
  scope: ErasureScope,
  requestedBy: PrivacyErasureJob['requestedBy'],
): Promise<PrivacyErasureJob> => {
  const now = new Date().toISOString();
  const hash = subjectHash(userId);
  await upsertErasureTombstone({ subjectHash: hash, scope, erasedAt: now });
  invalidateErasureCache(userId);
  const job: PrivacyErasureJob = {
    id: randomUUID(),
    subjectHash: hash,
    userId,
    scope,
    status: 'pending',
    steps: Object.fromEntries(listErasureSteps(scope).map((s) => [s.name, { status: 'pending' } as ErasureStepState])),
    attempts: 0,
    lastError: null,
    requestedBy,
    requestedAt: now,
    dueAt: addDays(now, ERASURE_DUE_DAYS),
    completedAt: null,
  };
  await saveErasureJob(job);
  logInfo(`[privacy] erasure requested scope=${scope} job=${job.id}`);
  return runErasureJob(job);
};

/** Retention-tick step: retries failed or interrupted jobs (bounded attempts). */
export const processPendingErasureJobs = async (): Promise<{ retried: number; completed: number; exhausted: number }> => {
  const candidates = [
    ...(await listErasureJobs({ status: 'failed', limit: 100 })),
    ...(await listErasureJobs({ status: 'pending', limit: 100 })),
  ];
  let completed = 0;
  let exhausted = 0;
  let retried = 0;
  for (const job of candidates) {
    if (job.attempts >= MAX_ERASURE_ATTEMPTS) {
      exhausted += 1;
      continue;
    }
    retried += 1;
    const result = await runErasureJob(job);
    if (result.status === 'completed') completed += 1;
  }
  if (exhausted) incrementMetric('privacy.erasure_job_exhausted', undefined, exhausted);
  return { retried, completed, exhausted };
};

export const getErasureJobForUser = async (userId: string, jobId: string): Promise<PrivacyErasureJob | null> => {
  const job = await getErasureJob(jobId);
  return job && job.subjectHash === subjectHash(userId) ? job : null;
};

export const listErasureJobsForUser = async (userId: string): Promise<PrivacyErasureJob[]> =>
  listErasureJobs({ subjectHash: subjectHash(userId), limit: 50 });

// ── Tombstone checks for late writers ────────────────────────────────────────

const ERASURE_CACHE_TTL_MS = 5 * 60 * 1000;
const erasureCache = new Map<string, { erasedAt: string | null; expiresAt: number }>();

const invalidateErasureCache = (userId: string): void => {
  erasureCache.delete(`account:${userId}`);
  erasureCache.delete(`analytics:${userId}`);
};

/** When the subject was erased for `scope`, or null. Cached briefly so hot paths add no DB read. */
export const getErasedAt = async (userId: string, scope: ErasureScope): Promise<string | null> => {
  const key = `${scope}:${userId}`;
  const cached = erasureCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.erasedAt;
  const tombstone = await getErasureTombstone(subjectHash(userId), scope);
  const erasedAt = tombstone?.erasedAt ?? null;
  if (erasureCache.size > 10_000) erasureCache.clear();
  erasureCache.set(key, { erasedAt, expiresAt: Date.now() + ERASURE_CACHE_TTL_MS });
  return erasedAt;
};

export const isAccountErased = async (userId: string): Promise<boolean> => Boolean(await getErasedAt(userId, 'account'));

export const clearErasureCacheForTesting = (): void => {
  erasureCache.clear();
};

// ── Statutory deadlines for manually received requests ───────────────────────

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
const addCalendarMonths = (iso: string, months: number): string => {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1,
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
};

/**
 * Response deadline for a rights request. GDPR/UK GDPR: one month, extendable by two
 * further months (Art. 12(3)). CCPA and other US state laws: 45 days, extendable once
 * by 45 days. Anything else: 30 days (+30). Counsel should confirm per launch market.
 */
export const computeRightsDueDate = (jurisdiction: PrivacyJurisdiction, receivedAtIso: string, extended: boolean): string => {
  switch (jurisdiction) {
    case 'GDPR':
    case 'UK_GDPR':
      return addCalendarMonths(receivedAtIso, extended ? 3 : 1);
    case 'CCPA':
    case 'US_STATE':
      return addDays(receivedAtIso, extended ? 90 : 45);
    default:
      return addDays(receivedAtIso, extended ? 60 : 30);
  }
};
