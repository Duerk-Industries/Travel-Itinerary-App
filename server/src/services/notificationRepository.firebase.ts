import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '../db.firebase';

const nowIso = () => new Date().toISOString();

export const createNotification = async (n: any): Promise<string> => {
  const db = getDb();
  const id = randomUUID();
  const dedupeKey = n.dedupeKey || null;

  if (dedupeKey) {
    const docId = `${n.userId}:${dedupeKey}`;
    const ref = db.collection('notifications').doc(docId);
    const snap = await ref.get();
    if (snap.exists) return snap.id;

    const data = { ...n, createdAt: nowIso(), readAt: null, seenAt: null };
    await ref.set(data);
    return docId;
  } else {
    const ref = db.collection('notifications').doc(id);
    const data = { ...n, createdAt: nowIso(), readAt: null, seenAt: null };
    await ref.set(data);
    return id;
  }
};

export const enqueueOutbox = async (entries: any[]): Promise<void> => {
  const db = getDb();
  const batch = db.batch();
  for (const e of entries) {
    const id = `${e.notificationId}:${e.channel}`;
    const ref = db.collection('notification_outbox').doc(id);
    batch.set(ref, {
      ...e,
      state: 'pending',
      attemptCount: 0,
      nextAttemptAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    }, { merge: true });
  }
  await batch.commit();
};

export const getPreferences = async (userIds: string[]): Promise<any[]> => {
  if (!userIds.length) return [];
  const db = getDb();
  const snaps = await Promise.all(userIds.map(id => db.collection('notification_preferences').where('userId', '==', id).get()));
  return snaps.flatMap(s => s.docs.map(doc => ({ ...doc.data(), user_id: doc.data().userId })));
};

export const isThreadMuted = async (userId: string, threadKey: string): Promise<boolean> => {
  const snap = await getDb().collection('notification_thread_mutes').doc(`${userId}:${threadKey}`).get();
  return snap.exists;
};

export const getUnreadCount = async (userId: string): Promise<number> => {
  const snap = await getDb().collection('notifications')
    .where('userId', '==', userId)
    .where('readAt', '==', null)
    .get();
  return snap.size;
};

export const listNotifications = async (userId: string, options: any): Promise<any[]> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const db = getDb();
  let query = db.collection('notifications').where('userId', '==', userId);
  if (options.unreadOnly) query = query.where('readAt', '==', null);

  const snap = await query.get();
  return snap.docs
    .map(doc => ({ ...doc.data(), id: doc.id }))
    .filter(n => !options.cursor || n.createdAt < options.cursor)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
};

export const markAsRead = async (userId: string, ids: string[] | 'all'): Promise<void> => {
  const db = getDb();
  const now = nowIso();
  if (ids === 'all') {
    const snap = await db.collection('notifications').where('userId', '==', userId).where('readAt', '==', null).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.update(doc.ref, { readAt: now }));
    await batch.commit();
  } else if (ids.length) {
    const batch = db.batch();
    ids.forEach(id => batch.update(db.collection('notifications').doc(id), { readAt: now }));
    await batch.commit();
  }
};

export const upsertDevice = async (userId: string, d: any): Promise<void> => {
  const db = getDb();
  const id = `${userId}:${d.pushTokenHash}`;
  await db.collection('notification_devices').doc(id).set({
    ...d,
    userId,
    lastSeenAt: nowIso(),
    disabledAt: null,
    createdAt: nowIso()
  }, { merge: true });
};

export const listDevices = async (userId: string): Promise<any[]> => {
  const snap = await getDb().collection('notification_devices')
    .where('userId', '==', userId)
    .where('disabledAt', '==', null)
    .get();
  return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
};

export const deleteDevice = async (userId: string, deviceId: string): Promise<void> => {
  await getDb().collection('notification_devices').doc(deviceId).update({ disabledAt: nowIso() });
};

export const updatePreferences = async (userId: string, prefs: any[]): Promise<void> => {
  const db = getDb();
  const batch = db.batch();
  for (const p of prefs) {
    const id = `${userId}:${p.category}`;
    batch.set(db.collection('notification_preferences').doc(id), { ...p, userId }, { merge: true });
  }
  await batch.commit();
};

export const claimOutboxBatch = async (leaseOwner: string, batchSize: number, leaseSeconds: number): Promise<any[]> => {
  const db = getDb();
  const now = nowIso();
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();

  // Firestore doesn't have a direct equivalent of UPDATE ... WHERE id IN (SELECT ...)
  // We'll have to query then update in a transaction.
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(db.collection('notification_outbox')
      .where('state', 'in', ['pending', 'leased'])
      .where('nextAttemptAt', '<=', now)
      .limit(batchSize));

    const claimable = snap.docs.filter(doc => {
      const data = doc.data();
      return !data.leaseExpiresAt || data.leaseExpiresAt < now;
    });

    claimable.forEach(doc => {
      transaction.update(doc.ref, {
        state: 'leased',
        leaseOwner,
        leaseExpiresAt,
        updatedAt: now
      });
    });

    return claimable.map(doc => ({ ...doc.data(), id: doc.id }));
  });
};

export const updateOutboxState = async (id: string, state: string, options: any = {}): Promise<void> => {
  const db = getDb();
  const update: any = {
    state,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: nowIso()
  };
  if (options.attemptCount != null) update.attemptCount = options.attemptCount;
  if (options.nextAttemptAt != null) update.nextAttemptAt = options.nextAttemptAt.toISOString();
  if (options.lastErrorCode != null) update.lastErrorCode = options.lastErrorCode;

  await db.collection('notification_outbox').doc(id).update(update);
};

export const pruneNotifications = async (retentionDays: number, maxPerRow: number): Promise<void> => {
  // Pruning logic for Firestore can be implemented here.
};
