import { randomUUID } from 'crypto';
import { queryBlog, withBlogTransaction } from '../db.postgres';

export const createNotification = async (n: any): Promise<string> => {
  const id = randomUUID();
  await queryBlog(
    `INSERT INTO notifications (id, user_id, category, trip_id, actor_user_id, title, body, deep_link, payload, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [id, n.userId, n.category, n.tripId ?? null, n.actorUserId ?? null, n.title, n.body, n.deepLink ?? null, JSON.stringify(n.payload ?? {}), n.dedupeKey ?? null]
  );
  return id;
};

export const enqueueOutbox = async (entries: any[]): Promise<void> => {
  for (const e of entries) {
    await queryBlog(
      `INSERT INTO notification_outbox (id, notification_id, channel)
       VALUES ($1, $2, $3)
       ON CONFLICT (notification_id, channel) DO NOTHING`,
      [randomUUID(), e.notificationId, e.channel]
    );
  }
};

export const getPreferences = async (userIds: string[]): Promise<any[]> => {
  if (!userIds.length) return [];
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await queryBlog(`SELECT * FROM notification_preferences WHERE user_id IN (${placeholders})`, userIds);
  return result.rows;
};

export const isThreadMuted = async (userId: string, threadKey: string): Promise<boolean> => {
  const result = await queryBlog('SELECT 1 FROM notification_thread_mutes WHERE user_id = $1 AND thread_key = $2', [userId, threadKey]);
  return result.rows.length > 0;
};

export const getUnreadCount = async (userId: string): Promise<number> => {
  const result = await queryBlog('SELECT COUNT(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return result.rows[0]?.count ?? 0;
};

export const listNotifications = async (userId: string, options: { limit?: number; cursor?: string; unreadOnly?: boolean }): Promise<any[]> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const unreadClause = options.unreadOnly ? 'AND read_at IS NULL' : '';
  const cursorClause = options.cursor ? 'AND created_at < (SELECT created_at FROM notifications WHERE id = $3)' : '';
  const params: any[] = [userId];
  if (options.cursor) params.push(options.cursor);

  const result = await queryBlog(
    `SELECT * FROM notifications WHERE user_id = $1 ${unreadClause} ${cursorClause}
     ORDER BY created_at DESC LIMIT ${limit}`,
    params
  );
  return result.rows;
};

export const markAsRead = async (userId: string, ids: string[] | 'all'): Promise<void> => {
  if (ids === 'all') {
    await queryBlog('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  } else if (ids.length) {
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    await queryBlog(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND id IN (${placeholders}) AND read_at IS NULL`, [userId, ...ids]);
  }
};

export const upsertDevice = async (userId: string, d: any): Promise<void> => {
  await queryBlog(
    `INSERT INTO notification_devices (id, user_id, platform, push_token_ciphertext, push_token_hash, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, push_token_hash) DO UPDATE
     SET last_seen_at = NOW(), device_label = EXCLUDED.device_label, disabled_at = NULL`,
    [randomUUID(), userId, d.platform, d.pushTokenCiphertext, d.pushTokenHash, d.deviceLabel ?? null]
  );
};

export const listDevices = async (userId: string): Promise<any[]> => {
  const result = await queryBlog('SELECT id, platform, device_label, permission_state, last_seen_at, created_at FROM notification_devices WHERE user_id = $1 AND disabled_at IS NULL', [userId]);
  return result.rows;
};

export const deleteDevice = async (userId: string, deviceId: string): Promise<void> => {
  await queryBlog('UPDATE notification_devices SET disabled_at = NOW() WHERE user_id = $1 AND id = $2', [userId, deviceId]);
};

export const updatePreferences = async (userId: string, prefs: any[]): Promise<void> => {
  for (const p of prefs) {
    await queryBlog(
      `INSERT INTO notification_preferences (user_id, category, in_app, push, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, category) DO UPDATE
       SET in_app = EXCLUDED.in_app, push = EXCLUDED.push, email = EXCLUDED.email`,
      [userId, p.category, p.inApp, p.push, p.email]
    );
  }
};

export const claimOutboxBatch = async (leaseOwner: string, batchSize: number, leaseSeconds: number): Promise<any[]> => {
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
  const result = await queryBlog(
    `UPDATE notification_outbox
     SET state = 'leased', lease_owner = $1, lease_expires_at = $2, updated_at = NOW()
     WHERE id IN (
       SELECT id FROM notification_outbox
       WHERE state IN ('pending', 'leased')
         AND next_attempt_at <= NOW()
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT $3
     )
     RETURNING *`,
    [leaseOwner, leaseExpiresAt, batchSize]
  );
  return result.rows;
};

export const updateOutboxState = async (id: string, state: string, options: any = {}): Promise<void> => {
  const sets = ['state = $2', 'lease_owner = NULL', 'lease_expires_at = NULL', 'updated_at = NOW()'];
  const params: any[] = [id, state];
  if (options.attemptCount != null) { sets.push(`attempt_count = $${params.length + 1}`); params.push(options.attemptCount); }
  if (options.nextAttemptAt != null) { sets.push(`next_attempt_at = $${params.length + 1}`); params.push(options.nextAttemptAt); }
  if (options.lastErrorCode != null) { sets.push(`last_error_code = $${params.length + 1}`); params.push(options.lastErrorCode); }

  await queryBlog(`UPDATE notification_outbox SET ${sets.join(', ')} WHERE id = $1`, params);
};

export const pruneNotifications = async (retentionDays: number, maxPerRow: number): Promise<void> => {
  await queryBlog('DELETE FROM notifications WHERE created_at < NOW() - $1 * INTERVAL \'1 day\'', [retentionDays]);
  // Additional row-based pruning can be added here if needed.
};
