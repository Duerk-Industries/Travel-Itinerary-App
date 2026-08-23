export type NotificationCategory = 'blog_mention' | 'blog_comment_reply' | 'blog_nudge' | 'blog_reaction_digest' | 'blog_memory_lane' | 'blog_milestone';

export interface Notification {
  id: string;
  userId: string;
  category: NotificationCategory;
  tripId?: string | null;
  actorUserId?: string | null;
  title: string;
  body: string;
  deepLink?: string | null;
  payload: Record<string, any>;
  readAt?: string | null;
  seenAt?: string | null;
  createdAt: string;
  dedupeKey?: string | null;
}

export interface NotificationDevice {
  id: string;
  userId: string;
  platform: 'ios' | 'android' | 'web';
  pushTokenCiphertext: string;
  pushTokenHash: string;
  deviceLabel?: string | null;
  permissionState: 'granted' | 'denied' | 'undetermined' | 'revoked';
  lastSeenAt: string;
  failureCount: number;
  disabledAt?: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  userId: string;
  category: NotificationCategory;
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface NotificationOutboxEntry {
  id: string;
  notificationId: string;
  channel: 'push' | 'email';
  state: 'pending' | 'leased' | 'sent' | 'dead';
  attemptCount: number;
  nextAttemptAt: string;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  lastErrorCode?: string | null;
  createdAt: string;
  updatedAt: string;
}
