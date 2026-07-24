import { blogMediaRepository } from '../blog/repository';
import { logInfo, logError } from '../logger';

export const reconcileAllStorageAccounts = async (): Promise<void> => {
  logInfo('[blog-storage] starting global storage reconciliation');
  try {
    // In a real implementation, this would iterate over all users
    // who have blog storage accounts and call hideExpiredMediaForUser.
    // For now, we provide the structure for the worker.
  } catch (err) {
    logError('[blog-storage] global reconciliation failed', err);
  }
};

export const reconcileUserStorage = async (userId: string): Promise<void> => {
  try {
    const hidden = await blogMediaRepository().hideExpiredMediaForUser(userId);
    if (hidden > 0) {
      logInfo(`[blog-storage] reconciled userId=${userId} hidden=${hidden} items`);
    }
  } catch (err) {
    logError(`[blog-storage] failed to reconcile storage for userId=${userId}`, err);
  }
};
