/// <reference types="jest" />

import { cleanupExpiredExperimentAssignments, completeExpiredRunningExperiments } from '../../src/ai/experiments/lifecycle';
import {
  deleteCompletedAiExperimentAssignmentsOlderThan,
  getAdminSetting,
  listAiExperiments,
  updateAiExperimentStatus,
} from '../../src/db';

jest.mock('../../src/db', () => ({
  listAiExperiments: jest.fn(),
  updateAiExperimentStatus: jest.fn(),
  getAdminSetting: jest.fn(),
  deleteCompletedAiExperimentAssignmentsOlderThan: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

describe('experiment lifecycle jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('auto-completes running experiments past maxDurationDays', async () => {
    (listAiExperiments as jest.Mock).mockResolvedValue([
      {
        experimentId: 'exp-old',
        startedAt: '2026-06-01T00:00:00.000Z',
        maxDurationDays: 30,
      },
      {
        experimentId: 'exp-new',
        startedAt: '2026-07-01T00:00:00.000Z',
        maxDurationDays: 30,
      },
    ]);
    (updateAiExperimentStatus as jest.Mock).mockResolvedValue({});

    await expect(completeExpiredRunningExperiments(new Date('2026-07-06T00:00:00.000Z'))).resolves.toBe(1);
    expect(updateAiExperimentStatus).toHaveBeenCalledWith({ experimentId: 'exp-old', status: 'completed' });
  });

  it('deletes only assignments older than the configured retention cutoff', async () => {
    (getAdminSetting as jest.Mock).mockResolvedValue({ value: '90' });
    (deleteCompletedAiExperimentAssignmentsOlderThan as jest.Mock).mockResolvedValue(4);

    await expect(cleanupExpiredExperimentAssignments(new Date('2026-07-06T00:00:00.000Z'))).resolves.toBe(4);
    expect(deleteCompletedAiExperimentAssignmentsOlderThan).toHaveBeenCalledWith('2026-04-07T00:00:00.000Z');
  });
});
