export const notificationCursor = (notification: { id: string; createdAt?: string; created_at?: Date | string }): string =>
  Buffer.from(JSON.stringify({ id: notification.id, t: new Date(notification.createdAt || notification.created_at!).toISOString() })).toString('base64url');
export const parseNotificationCursor = (cursor?: string): { id: string; t: string } | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.id !== 'string' || parsed.id.length > 512 || typeof parsed.t !== 'string' || !Number.isFinite(Date.parse(parsed.t))) throw new Error();
    return { id: parsed.id, t: new Date(parsed.t).toISOString() };
  } catch { throw new Error('Invalid notification cursor'); }
};
