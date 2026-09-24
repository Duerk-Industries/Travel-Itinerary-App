import { queryBlog } from '../db.postgres';

// Phase 0's "DB lease primitive" prerequisite (blocked Phases 2, 4.5, 6; not built in Phase 1 —
// built here, in Phase 2, scoped to what the counter reconciliation job below actually needs
// rather than as a speculative framework). A unique (job_key, window_start) row in
// scheduled_job_leases IS the lease: claiming is a plain INSERT that either succeeds or hits the
// unique constraint — atomic on every adapter, including pg-mem, without relying on
// `SELECT ... FOR UPDATE SKIP LOCKED` semantics that horizontal-scaling-requirements.md flags as
// unverified there.
//
// This directly closes register rows 9/15a in docs/horizontal-scaling-requirements.md for any job
// that adopts it: N instances racing to claim the same window produce exactly one winner, so
// "N instances running the same scheduled job" stops being a correctness question and becomes
// only "did the loser instance retry needlessly" — which it doesn't, since claimJobLease returns
// false immediately rather than blocking.
//
// Postgres/memory only. A Firebase equivalent (a document transaction with a deterministic ID —
// see architecture §3.5) is not built here: nothing in Phase 2 needs it yet — the counter
// reconciliation job below is the only caller, and Firestore counters are already atomic via
// FieldValue.increment (firebaseEngagementRepository.ts), so the same drift problem this lease
// exists to let a job safely fix doesn't arise there the way it does for Postgres/pg-mem's
// read-then-write JSONB counters.

export const claimJobLease = async (jobKey: string, windowStart: Date, leaseOwner: string): Promise<boolean> => {
  try {
    await queryBlog(
      'INSERT INTO scheduled_job_leases (job_key, window_start, lease_owner) VALUES ($1, $2, $3)',
      [jobKey, windowStart, leaseOwner]
    );
    return true;
  } catch {
    // Unique (job_key, window_start) violation — another instance already claimed this window.
    return false;
  }
};

export const completeJobLease = async (jobKey: string, windowStart: Date): Promise<void> => {
  await queryBlog(
    'UPDATE scheduled_job_leases SET completed_at = NOW() WHERE job_key = $1 AND window_start = $2',
    [jobKey, windowStart]
  );
};
