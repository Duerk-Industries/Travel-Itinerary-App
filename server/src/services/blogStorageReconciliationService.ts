import { blogMediaRepository } from '../blog/repository';
import { logInfo, logError } from '../logger';

export const reconcileAllStorageAccounts = async (): Promise<void> => {
  logInfo('[blog-storage] starting global storage reconciliation');
  try {
    const userIds = await blogMediaRepository().listStorageAccountUserIds();
    logInfo(`[blog-storage] reconciling ${userIds.length} accounts`);
    for (const userId of userIds) {
      await reconcileUserStorage(userId);
    }
    logInfo('[blog-storage] global reconciliation complete');
  } catch (err) {
    logError('[blog-storage] global reconciliation failed', err);
  }
};

export const reconcileUserStorage = async (userId: string): Promise<void> => {
  try {
    logInfo(`[blog-storage] reconciling userId=${userId}`);
    const hidden = await blogMediaRepository().hideExpiredMediaForUser(userId);
    if (hidden > 0) {
      logInfo(`[blog-storage] reconciled userId=${userId} hidden=${hidden} items`);
    } else {
      logInfo(`[blog-storage] reconciled userId=${userId} nothing to hide`);
    }
  } catch (err) {
    logError(`[blog-storage] failed to reconcile storage for userId=${userId}`, err);
  }
};

let schedulerHandle: NodeJS.Timeout | null = null;

export const startBlogStorageReconciliationScheduler = (): void => {
  if (schedulerHandle) return;
  logInfo('[blog-storage] starting reconciliation scheduler');

  const tick = () => {
    void reconcileAllStorageAccounts().finally(() => {
      schedulerHandle = setTimeout(tick, 6 * 60 * 60 * 1000); // every 6 hours
    });
  };

  schedulerHandle = setTimeout(tick, 5000); // first run in 5s
};
