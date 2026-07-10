import {
  deleteCompletedAiExperimentAssignmentsOlderThan,
  getAdminSetting,
  listAiExperiments,
  updateAiExperimentStatus,
} from '../../db';
import { logError } from '../../logger';
import { clearExperimentConfigCache } from './experimentConfigService';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseSettingNumber = async (key: string, fallback: number): Promise<number> => {
  const row = await getAdminSetting(key);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const completeExpiredRunningExperiments = async (now = new Date()): Promise<number> => {
  const running = await listAiExperiments({ status: 'running', limit: 500 });
  let completed = 0;
  for (const experiment of running) {
    const startedAt = experiment.startedAt ? new Date(experiment.startedAt).getTime() : NaN;
    if (!Number.isFinite(startedAt)) continue;
    const expiresAt = startedAt + experiment.maxDurationDays * MS_PER_DAY;
    if (expiresAt > now.getTime()) continue;
    try {
      await updateAiExperimentStatus({ experimentId: experiment.experimentId, status: 'completed' });
      completed += 1;
    } catch (err) {
      logError('[ai-experiments] failed to auto-complete expired experiment', err);
    }
  }
  if (completed > 0) clearExperimentConfigCache();
  return completed;
};

export const cleanupExpiredExperimentAssignments = async (now = new Date()): Promise<number> => {
  const retentionDays = await parseSettingNumber('EXPERIMENT_ASSIGNMENT_RETENTION_DAYS', 90);
  const cutoffIso = new Date(now.getTime() - retentionDays * MS_PER_DAY).toISOString();
  return deleteCompletedAiExperimentAssignmentsOlderThan(cutoffIso);
};
