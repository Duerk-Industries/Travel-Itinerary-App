import { parseNotificationCursor } from './notificationCursor';
import { createHash, randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '../db.firebase';

const nowIso = () => new Date().toISOString();

export const createNotificationWithOutbox = async (n: any, channels: Array<'push' | 'email'>): Promise<string> => {
  const db = getDb();
  const id = n.dedupeKey ? createHash('sha256').update(`${n.userId}:${n.dedupeKey}`).digest('hex') : randomUUID();
  const ref = db.collection('notifications').doc(id);
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    const outbox = await Promise.all(channels.map(async channel => {
      const ref = db.collection('notification_outbox').doc(`${id}:${channel}`);
      return { ref, channel, exists: (await tx.get(ref)).exists };
    }));
    if (!previous.exists) tx.create(ref, { ...n, inApp: n.inApp !== false, createdAt: nowIso(), readAt: null, seenAt: null });
    for (const entry of outbox) if (!entry.exists) tx.create(entry.ref, { notificationId: id, channel: entry.channel, state: 'pending', attemptCount: 0, nextAttemptAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso() });
  });
  return id;
};
export const createNotification = (n: any): Promise<string> => createNotificationWithOutbox(n, []);

export const enqueueOutbox = async (entries: any[]): Promise<void> => {
  const db = getDb();
  for (const entry of entries) {
    const ref = db.collection('notification_outbox').doc(`${entry.notificationId}:${entry.channel}`);
    await db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (!existing.exists) tx.create(ref, { ...entry, state: 'pending', attemptCount: 0, nextAttemptAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso() });
    });
  }
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
    .where('inApp', '==', true)
    .where('readAt', '==', null)
    .get();
  return snap.size;
};

export const listNotifications = async (userId: string, options: { limit?: number; cursor?: string; unreadOnly?: boolean }): Promise<any[]> => {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  let query = getDb().collection('notifications').where('userId', '==', userId).where('inApp', '==', true);
  if (options.unreadOnly) query = query.where('readAt', '==', null);
  const cursor = parseNotificationCursor(options.cursor);
  let ordered = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
  if (cursor) ordered = ordered.startAfter(cursor.t, cursor.id);
  return (await ordered.limit(limit).get()).docs.map(doc => ({ ...doc.data(), id: doc.id }));
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

// Same columns and snake_case names as the Postgres adapter. The encrypted token and its hash are
// never part of this public projection (listActivePushDevicesForUser is the internal delivery read).
export const listDevices = async (userId: string): Promise<any[]> => {
  const snap = await getDb().collection('notification_devices')
    .where('userId', '==', userId)
    .where('disabledAt', '==', null)
    .get();
  return snap.docs.map(doc => {
    const d = doc.data() as any;
    return {
      id: doc.id, platform: d.platform, device_label: d.deviceLabel ?? null,
      permission_state: d.permissionState ?? null, last_seen_at: d.lastSeenAt ?? null, created_at: d.createdAt ?? null,
    };
  });
};

// Only the owner's own device can be disabled (Postgres filters on user_id the same way).
export const deleteDevice = async (userId: string, deviceId: string): Promise<void> => {
  const ref = getDb().collection('notification_devices').doc(deviceId);
  await getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && (snap.data() as any).userId === userId) tx.update(ref, { disabledAt: nowIso() });
  });
};

export const getNotificationById = async (id: string): Promise<any | null> => {
  const doc = await getDb().collection('notifications').doc(id).get();
  if (!doc.exists) return null;
  return { ...(doc.data() as any), id: doc.id };
};

export const listActivePushDevicesForUser = async (userId: string): Promise<any[]> => {
  const snap = await getDb().collection('notification_devices')
    .where('userId', '==', userId)
    .where('disabledAt', '==', null)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((d: any) => d.platform === 'ios' || d.platform === 'android');
};

export const incrementDeviceFailure = async (deviceId: string): Promise<void> => {
  await getDb().collection('notification_devices').doc(deviceId).update({ failureCount: FieldValue.increment(1) });
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

  const ref = db.collection('notification_outbox').doc(id);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || (options.leaseOwner && doc.data()?.leaseOwner !== options.leaseOwner)) return;
    tx.update(ref, update);
  });
};

export const pruneNotifications = async (retentionDays: number, maxPerRow: number): Promise<void> => {
  // Pruning logic for Firestore can be implemented here.
};

/** Erasure: hard-deletes the user's devices, including encrypted push tokens (deleteDevice only disables). */
export const purgeDevicesForUser = async (userId: string): Promise<number> => {
  const db = getDb();
  const snap = await db.collection('notification_devices').where('userId', '==', userId).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.docs.length;
};
