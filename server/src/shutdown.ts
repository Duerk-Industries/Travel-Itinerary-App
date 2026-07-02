import type { Server } from 'http';
import { closePool } from './db';
import { logError, logInfo } from './logger';
import { stopFailedRetryScheduler } from './services/failedRetryScheduler';
import { stopGmailPollingScheduler } from './services/gmailPollingService';
import { stopIngestionMetricsScheduler } from './services/ingestionMetricsService';
import { stopRetentionScheduler } from './services/retentionService';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

let shutdownStarted = false;

const closeHttpServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

export const __resetShutdownStateForTests = (): void => {
  shutdownStarted = false;
};

export const gracefulShutdown = async (
  server: Server,
  signal: ShutdownSignal,
  opts: { timeoutMs?: number } = {},
): Promise<void> => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 9000));
  logInfo(`[shutdown] ${signal} received; draining HTTP server and closing resources (timeout=${timeoutMs}ms)`);

  stopGmailPollingScheduler();
  stopRetentionScheduler();
  stopIngestionMetricsScheduler();
  stopFailedRetryScheduler();

  const forceCloseTimer = setTimeout(() => {
    logError('[shutdown] graceful timeout reached; closing remaining HTTP connections', { timeoutMs });
    server.closeAllConnections?.();
  }, timeoutMs);
  forceCloseTimer.unref();

  try {
    await closeHttpServer(server);
    await closePool();
    logInfo('[shutdown] complete');
  } finally {
    clearTimeout(forceCloseTimer);
  }
};

export const installShutdownHandlers = (server: Server): void => {
  const handle = (signal: ShutdownSignal) => {
    gracefulShutdown(server, signal)
      .then(() => process.exit(0))
      .catch((err) => {
        logError('[shutdown] failed', err);
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => handle('SIGTERM'));
  process.once('SIGINT', () => handle('SIGINT'));
};
