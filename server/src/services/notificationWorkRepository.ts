import { randomUUID } from 'crypto';
import { getCurrentDbProvider } from '../db';
import { getDb } from '../db.firebase';
import { queryBlog } from '../db.postgres';

export type NotificationWork = { id: string; kind: 'scan' | 'deadline' | 'digest' | 'receipt'; dueAt: number; data: Record<string, unknown>; leaseToken?: string };
const firebase = () => getCurrentDbProvider() === 'firebase';

export const putNotificationWork = async (work: NotificationWork): Promise<void> => {
  if (firebase()) {
    const ref = getDb().collection('notification_work').doc(work.id);
    await getDb().runTransaction(async tx => { if (!(await tx.get(ref)).exists) tx.create(ref, { ...work, completed: false, leaseUntil: 0 }); });
  } else await queryBlog('INSERT INTO notification_work(id,kind,due_at,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [work.id, work.kind, work.dueAt, JSON.stringify(work.data)]);
};

/** CAS per candidate, not an unfenced UPDATE of a previously read batch. */
export const claimNotificationWork = async (now: number): Promise<NotificationWork[]> => {
  if (firebase()) return getDb().runTransaction(async tx => {
    const snapshot = await tx.get(getDb().collection('notification_work').where('completed', '==', false).where('dueAt', '<=', now).orderBy('dueAt').limit(50));
    const jobs: NotificationWork[] = [];
    for (const doc of snapshot.docs) {
      const value = doc.data(); if (value.leaseUntil > now) continue;
      const leaseToken = randomUUID(); tx.update(doc.ref, { leaseToken, leaseUntil: now + 120_000 });
      jobs.push({ id: doc.id, kind: value.kind, dueAt: value.dueAt, data: value.data, leaseToken });
    }
    return jobs;
  });
  const candidates = await queryBlog('SELECT id FROM notification_work WHERE completed=false AND due_at <= $1 AND lease_until <= $1 ORDER BY due_at LIMIT 50', [now]);
  const jobs: NotificationWork[] = [];
  for (const candidate of candidates.rows) {
    const leaseToken = randomUUID();
    const claimed = await queryBlog('UPDATE notification_work SET lease_token=$2,lease_until=$3 WHERE id=$1 AND completed=false AND lease_until <= $4 RETURNING *', [candidate.id, leaseToken, now + 120_000, now]);
    if (claimed.rows[0]) { const row = claimed.rows[0]; jobs.push({ id: row.id, kind: row.kind, dueAt: Number(row.due_at), data: row.data, leaseToken }); }
  }
  return jobs;
};

export const finishNotificationWork = async (job: NotificationWork, next?: { dueAt: number; data?: Record<string, unknown> }): Promise<boolean> => {
  if (firebase()) {
    const ref = getDb().collection('notification_work').doc(job.id);
    return getDb().runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (snapshot.data()?.leaseToken !== job.leaseToken) return false;
      tx.update(ref, { leaseToken: null, leaseUntil: 0, completed: !next, expiresAt: next ? null : new Date(Date.now() + 30 * 86400_000), ...(next ? { dueAt: next.dueAt, data: next.data ?? job.data } : {}) }); return true;
    });
  }
  const result = await queryBlog(`UPDATE notification_work SET expires_at=CASE WHEN $3 THEN NOW() + INTERVAL '30 days' ELSE NULL END,completed=$3,lease_token=NULL,lease_until=0,due_at=$4,data=$5 WHERE id=$1 AND lease_token=$2`, [job.id, job.leaseToken, !next, next?.dueAt ?? job.dueAt, JSON.stringify(next?.data ?? job.data)]);
  return result.rowCount > 0;
};

export const planningTripScanPage = async (cursor: string): Promise<Array<{ id: string; groupId: string; ownerId: string }>> => {
  if (firebase()) {
    let query = getDb().collection('trips').orderBy('__name__').limit(25);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return Promise.all(snapshot.docs.map(async doc => ({ id: doc.id, groupId: doc.data().groupId, ownerId: String((await getDb().collection('groups').doc(doc.data().groupId).get()).data()?.ownerId || '') })));
  }
  return (await queryBlog('SELECT t.id,t.group_id as "groupId",g.owner_id as "ownerId" FROM trips t JOIN groups g ON g.id=t.group_id WHERE t.id::text > $1 ORDER BY t.id LIMIT 25', [cursor])).rows;
};

export const completedPlanningSourcePage = async (source: 'imports' | 'generation', cursor: string): Promise<Array<{ id: string; userId: string; tripId?: string; createdAt: string; dryRun?: boolean; response?: unknown }>> => {
  if (source === 'imports') await (await import('../ingestion/shared/repository')).ensureIngestionRepositoryReady();
  if (firebase()) {
    const collection = source === 'imports' ? 'import_jobs' : 'generation_idempotency';
    let query = getDb().collection(collection).where(source === 'imports' ? 'state' : 'status', '==', source === 'imports' ? 'COMPLETED' : 'completed').orderBy('__name__').limit(25);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    return page.docs.map(doc => { const row = doc.data(); return { id: doc.id, userId: row.userId, tripId: row.tripId, createdAt: row.createdAt, dryRun: row.dryRun, response: row.responseBody }; });
  }
  const query = source === 'imports'
    ? `SELECT id::text as id,user_id as "userId",created_at as "createdAt",dry_run as "dryRun" FROM import_jobs WHERE state='COMPLETED' AND id::text > $1 ORDER BY id LIMIT 25`
    : `SELECT key as id,user_id as "userId",trip_id as "tripId",created_at as "createdAt",response_body as response FROM generation_idempotency WHERE status='completed' AND key > $1 ORDER BY key LIMIT 25`;
  return (await queryBlog(query, [cursor])).rows;
};

export const prunePlanningWork = async (): Promise<void> => {
  if (firebase()) {
    const db = getDb();
    const jobs = await db.collection('notification_work').where('completed', '==', true).where('expiresAt', '<=', new Date()).limit(100).get();
    const receipts = await db.collection('operation_receipts').where('expiresAt', '<=', new Date().toISOString()).limit(100).get();
    const batch = db.batch(); [...jobs.docs, ...receipts.docs].forEach(doc => batch.delete(doc.ref)); await batch.commit();
  } else {
    await queryBlog('DELETE FROM notification_work WHERE id IN (SELECT id FROM notification_work WHERE completed=true AND expires_at < $1 LIMIT 100)', [new Date(Date.now())]);
    const now = new Date(Date.now());
    const expired = (await queryBlog('SELECT user_id,operation_key FROM operation_receipts WHERE expires_at < $1 LIMIT 100', [now])).rows;
    if (expired.length) {
      const values: unknown[] = [now];
      const pairs = expired.map(row => {
        values.push(row.user_id, row.operation_key);
        return `(user_id=$${values.length - 1} AND operation_key=$${values.length})`;
      });
      await queryBlog(`DELETE FROM operation_receipts WHERE expires_at < $1 AND (${pairs.join(' OR ')})`, values);
    }
  }
};
