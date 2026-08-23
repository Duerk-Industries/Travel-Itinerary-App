import { randomUUID } from 'crypto';
import { queryBlog } from '../db.postgres';
import { getCurrentDbProvider } from '../db';
import { recomputeCounterRow } from '../blog/postgresEngagementRepository';
import { claimJobLease, completeJobLease } from './scheduledJobLease';
import { logInfo, logError } from '../logger';
import { BlogAudience } from '../blog/types';
import { BlogEngagementTargetKind } from '../blog/engagementTypes';

// Phase 2 of docs/trip-blog-social-implementation-plan.md — counter reconciliation. Postgres/
// memory only; see the note in scheduledJobLease.ts on why Firebase doesn't need this job (its
// counters are FieldValue.increment-atomic, not read-then-write JSONB).
//
// `blog_engagement_counters` rows are explicitly documented as disposable derived data
// (architecture §3.2/§14.6): the small race window in postgresEngagementRepository.ts's
// read-merge-write of `reaction_counts` is an accepted tradeoff *because* this job exists to
// correct any drift, not despite it. This job is what makes that acceptance actually true rather
// than aspirational.

const JOB_KEY = 'blog_counter_reconciliation';

const hourWindowStart = (date = new Date()): Date => {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
};

type TargetAudienceRow = { target_kind: string; target_id: string; trip_id: string; audience: string };

// Every (target, audience) combination that currently has *any* footprint — either real
// engagement rows or an existing (possibly now-orphaned) counter row. A target whose last
// reaction/comment was deleted still needs one more pass to zero out its counter, which is why
// blog_engagement_counters itself is part of this union, not just the two source tables.
const enumerateTargetAudiences = async (): Promise<TargetAudienceRow[]> => {
  // blog_reactions/blog_comments have no `target_id` column — like postgresEngagementRepository.ts's
  // targetIdFromRow, this reads back whichever of the three polymorphic FK columns is populated.
  // blog_engagement_counters is the one table here with a real `target_id` column (it isn't
  // polymorphic — see the migration), so its branch selects that directly instead.
  const result = await queryBlog<TargetAudienceRow>(`
    SELECT DISTINCT target_kind, COALESCE(blog_day_id, blog_item_id, asset_id) AS target_id, trip_id, audience FROM blog_reactions
    UNION
    SELECT DISTINCT target_kind, COALESCE(blog_day_id, blog_item_id, asset_id) AS target_id, trip_id, audience FROM blog_comments
    UNION
    SELECT DISTINCT target_kind, target_id, trip_id, audience FROM blog_engagement_counters
  `);
  return result.rows;
};

export const reconcileBlogCounters = async (leaseOwner: string = `pid-${process.pid}-${randomUUID()}`): Promise<{ ran: boolean; targetsReconciled: number }> => {
  if (getCurrentDbProvider() === 'firebase') return { ran: false, targetsReconciled: 0 };
  const windowStart = hourWindowStart();
  const claimed = await claimJobLease(JOB_KEY, windowStart, leaseOwner);
  if (!claimed) {
    logInfo('[blog-counter-reconciliation] window already claimed by another instance, skipping');
    return { ran: false, targetsReconciled: 0 };
  }
  try {
    const targets = await enumerateTargetAudiences();
    for (const row of targets) {
      await recomputeCounterRow(
        { query: queryBlog },
        row.trip_id,
        row.target_kind as BlogEngagementTargetKind,
        row.target_id,
        row.audience as BlogAudience
      );
    }
    await completeJobLease(JOB_KEY, windowStart);
    logInfo(`[blog-counter-reconciliation] reconciled ${targets.length} target/audience pairs`);
    return { ran: true, targetsReconciled: targets.length };
  } catch (err) {
    logError(`[blog-counter-reconciliation] failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
};

let schedulerHandle: ReturnType<typeof setTimeout> | null = null;

// Mirrors startBlogStorageReconciliationScheduler's setTimeout-chain shape (blogStorageReconciliationService.ts)
// but, unlike that one, is lease-guarded — multiple instances calling this all attempt the same
// hourly window, and only the first to win the INSERT actually does the work.
export const startBlogCounterReconciliationScheduler = (): void => {
  if (schedulerHandle) return;
  logInfo('[blog-counter-reconciliation] starting scheduler');

  const tick = () => {
    void reconcileBlogCounters().catch(() => {
      // Already logged inside reconcileBlogCounters; a failed run must not kill the scheduler.
    }).finally(() => {
      schedulerHandle = setTimeout(tick, 60 * 60 * 1000); // hourly, matching the lease window
    });
  };

  schedulerHandle = setTimeout(tick, 10_000); // first run in 10s
};

export const stopBlogCounterReconciliationSchedulerForTesting = (): void => {
  if (schedulerHandle) clearTimeout(schedulerHandle);
  schedulerHandle = null;
};
