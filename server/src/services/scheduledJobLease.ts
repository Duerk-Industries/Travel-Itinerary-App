import { queryBlog } from '../db.postgres';
import { getCurrentDbProvider } from '../db';
import { getDb } from '../db.firebase';

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
// Firestore: the same guarantee comes from `create()` on a deterministic document id, which fails
// with ALREADY_EXISTS for every racer but one. (The counter reconciliation job itself still skips
// Firestore, whose counters are FieldValue.increment-atomic, but the primitive works on both.)
const firebase = (): boolean => getCurrentDbProvider() === 'firebase';
const leaseDocId = (jobKey: string, windowStart: Date): string =>
  `${jobKey.replace(/[^A-Za-z0-9_-]/g, '_')}__${windowStart.toISOString()}`;

export const claimJobLease = async (jobKey: string, windowStart: Date, leaseOwner: string): Promise<boolean> => {
  if (firebase()) {
    try {
      await getDb().collection('scheduled_job_leases').doc(leaseDocId(jobKey, windowStart)).create({
        jobKey, windowStart: windowStart.toISOString(), leaseOwner, claimedAt: new Date().toISOString(), completedAt: null,
      });
      return true;
    } catch {
      // ALREADY_EXISTS: another instance holds this window. Any other failure also means "do not run".
      return false;
    }
  }
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
  if (firebase()) {
    await getDb().collection('scheduled_job_leases').doc(leaseDocId(jobKey, windowStart)).update({ completedAt: new Date().toISOString() });
    return;
  }
  await queryBlog(
    'UPDATE scheduled_job_leases SET completed_at = NOW() WHERE job_key = $1 AND window_start = $2',
    [jobKey, windowStart]
  );
};
