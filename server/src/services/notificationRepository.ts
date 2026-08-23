import { getCurrentDbProvider } from '../db';
import * as postgres from './notificationRepository.postgres';
import * as firebase from './notificationRepository.firebase';

export interface NotificationRepository {
  createNotification(notification: any): Promise<string>;
  enqueueOutbox(entries: any[]): Promise<void>;
  getPreferences(userIds: string[]): Promise<any[]>;
  isThreadMuted(userId: string, threadKey: string): Promise<boolean>;
  getUnreadCount(userId: string): Promise<number>;
  listNotifications(userId: string, options: { limit?: number; cursor?: string; unreadOnly?: boolean }): Promise<any[]>;
  markAsRead(userId: string, ids: string[] | 'all'): Promise<void>;
  upsertDevice(userId: string, device: any): Promise<void>;
  listDevices(userId: string): Promise<any[]>;
  deleteDevice(userId: string, deviceId: string): Promise<void>;
  updatePreferences(userId: string, preferences: any[]): Promise<void>;
  claimOutboxBatch(leaseOwner: string, batchSize: number, leaseSeconds: number): Promise<any[]>;
  updateOutboxState(id: string, state: string, options?: { attemptCount?: number; nextAttemptAt?: Date; lastErrorCode?: string | null }): Promise<void>;
  pruneNotifications(retentionDays: number, maxPerRow: number): Promise<void>;
}

export const notificationRepository = (): NotificationRepository =>
  getCurrentDbProvider() === 'firebase' ? (postgres as unknown as NotificationRepository) : (postgres as unknown as NotificationRepository);
