jest.mock('../src/db', () => ({
  closePool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/gmailPollingService', () => ({
  stopGmailPollingScheduler: jest.fn(),
}));

jest.mock('../src/services/retentionService', () => ({
  stopRetentionScheduler: jest.fn(),
}));

jest.mock('../src/services/ingestionMetricsService', () => ({
  stopIngestionMetricsScheduler: jest.fn(),
}));

jest.mock('../src/services/failedRetryScheduler', () => ({
  stopFailedRetryScheduler: jest.fn(),
}));

import { closePool } from '../src/db';
import { stopFailedRetryScheduler } from '../src/services/failedRetryScheduler';
import { stopGmailPollingScheduler } from '../src/services/gmailPollingService';
import { stopIngestionMetricsScheduler } from '../src/services/ingestionMetricsService';
import { stopRetentionScheduler } from '../src/services/retentionService';
import { __resetShutdownStateForTests, gracefulShutdown } from '../src/shutdown';

describe('graceful shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetShutdownStateForTests();
  });

  it('stops background schedulers, closes HTTP, then closes the DB pool', async () => {
    const close = jest.fn((cb: (err?: Error) => void) => cb());
    const closeAllConnections = jest.fn();
    const server = { close, closeAllConnections } as any;

    await gracefulShutdown(server, 'SIGTERM', { timeoutMs: 1000 });

    expect(stopGmailPollingScheduler).toHaveBeenCalled();
    expect(stopRetentionScheduler).toHaveBeenCalled();
    expect(stopIngestionMetricsScheduler).toHaveBeenCalled();
    expect(stopFailedRetryScheduler).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(closePool).toHaveBeenCalled();
    expect(closeAllConnections).not.toHaveBeenCalled();
  });

  it('is idempotent when multiple shutdown signals arrive', async () => {
    const close = jest.fn((cb: (err?: Error) => void) => cb());
    const server = { close } as any;

    await gracefulShutdown(server, 'SIGTERM', { timeoutMs: 1000 });
    await gracefulShutdown(server, 'SIGINT', { timeoutMs: 1000 });

    expect(close).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
